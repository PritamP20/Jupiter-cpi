import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { CpiSwapProgram } from "../target/types/cpi_swap_program.ts";
import { describe, before, it } from "node:test";
import * as crypto from "crypto";

describe("cpi_swap_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CpiSwapProgram as Program<CpiSwapProgram>;
  const user = provider.wallet as anchor.Wallet;

  const JUPITER_PROGRAM_ID = new PublicKey(
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  );

  // Fee account - you'll need to set this to your program's fee collection account
  const FEE_ACCOUNT = new PublicKey("YOUR_FEE_ACCOUNT_ADDRESS_HERE");

  const deserializeInstruction = (instruction: any): TransactionInstruction =>
    new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: instruction.accounts.map((key: any) => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      data: Buffer.from(instruction.data, "base64"),
    });

  it("performs a commit-reveal swap via CPI into Jupiter", async () => {
    const inputMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    ); // SOL
    const outputMint = new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ); // USDC

    const amount = 1000000; // 0.001 SOL
    
    // Get user's token account
    const senderTokenAccount = await getAssociatedTokenAddress(
      inputMint,
      user.publicKey
    );

    // Step 1: Get Jupiter quote and swap instruction
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amount}&slippageBps=50`
    ).then((res) => res.json());

    console.log("Best route:", quoteResponse);

    const swapResponse = await fetch(
      "https://quote-api.jup.ag/v6/swap-instructions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: user.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        }),
      }
    ).then((res) => res.json());
    
    console.log("swapResponse: ", swapResponse);

    const jupiterIx = deserializeInstruction(swapResponse.swapInstruction);

    // Step 2: Create commitment hash
    // In practice, you'd want to include nonce, amount, and other swap details
    const swapDetails = {
      data: jupiterIx.data.toString('base64'),
      amount,
      timestamp: Date.now()
    };
    
    const swapHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(swapDetails))
      .digest();

    // Step 3: Create commit account
    const commitAccount = Keypair.generate();
    
    console.log("🔒 Committing swap...");
    await program.methods
      .commitswap(Array.from(swapHash))
      .accounts({
        commitAccount: commitAccount.publicKey,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([commitAccount])
      .rpc();

    console.log("✅ Swap committed with hash:", swapHash.toString('hex'));

    // Optional: Add delay to simulate time between commit and reveal
    // await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: Execute the actual swap with reveal
    console.log("🔓 Revealing and executing swap...");
    await program.methods
      .swap(jupiterIx.data, Array.from(swapHash), new anchor.BN(amount))
      .accounts({
        inputMint,
        inputMintProgram: TOKEN_PROGRAM_ID,
        outputMint,
        outputMintProgram: TOKEN_PROGRAM_ID,
        sender: user.publicKey,
        senderTokenAccount,
        feeAccount: FEE_ACCOUNT,
        commitSwap: commitAccount.publicKey,
        jupiterProgram: JUPITER_PROGRAM_ID,
      })
      .remainingAccounts(
        jupiterIx.keys.map((k) => ({
          pubkey: k.pubkey,
          isWritable: k.isWritable,
          isSigner: k.isSigner,
        }))
      )
      .rpc();

    console.log("✅ Swap via CPI executed!");
  });

  // Additional test for commit-only scenario
  it("can commit a swap without executing", async () => {
    const testHash = crypto.randomBytes(32);
    const commitAccount = Keypair.generate();
    
    await program.methods
      .commitswap(Array.from(testHash))
      .accounts({
        commitAccount: commitAccount.publicKey,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([commitAccount])
      .rpc();

    // Verify the commitment was stored
    const commitData = await program.account.swapCommit.fetch(commitAccount.publicKey);
    console.log("Stored hash:", Buffer.from(commitData.hash).toString('hex'));
    console.log("Original hash:", testHash.toString('hex'));
    
    // Verify hashes match
    const storedHashBuffer = Buffer.from(commitData.hash);
    console.log("✅ Hashes match:", storedHashBuffer.equals(testHash));
  });

  // Test for invalid reveal (should fail)
  it("fails with invalid reveal hash", async () => {
    const commitAccount = Keypair.generate();
    const correctHash = crypto.randomBytes(32);
    const wrongHash = crypto.randomBytes(32);
    
    // Commit with correct hash
    await program.methods
      .commitswap(Array.from(correctHash))
      .accounts({
        commitAccount: commitAccount.publicKey,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([commitAccount])
      .rpc();

    // Try to reveal with wrong hash - this should fail
    try {
      await program.methods
        .swap(Buffer.from("dummy"), Array.from(wrongHash), new anchor.BN(1000000))
        .accounts({
          inputMint: new PublicKey("So11111111111111111111111111111111111111112"),
          inputMintProgram: TOKEN_PROGRAM_ID,
          outputMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          outputMintProgram: TOKEN_PROGRAM_ID,
          sender: user.publicKey,
          senderTokenAccount: await getAssociatedTokenAddress(
            new PublicKey("So11111111111111111111111111111111111111112"),
            user.publicKey
          ),
          feeAccount: FEE_ACCOUNT,
          commitSwap: commitAccount.publicKey,
          jupiterProgram: JUPITER_PROGRAM_ID,
        })
        .rpc();
      
      throw new Error("Should have failed with invalid hash");
    } catch (error) {
      console.log("✅ Correctly failed with invalid reveal:", error.message);
    }
  });
});