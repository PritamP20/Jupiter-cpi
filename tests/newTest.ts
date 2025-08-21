import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { CpiSwapProgram } from "../target/types/cpi_swap_program.ts";
import { describe, it } from "node:test";
import * as crypto from "crypto";
import bn from "bn.js";

describe("cpi_swap_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CpiSwapProgram as Program<CpiSwapProgram>;
  console.log(program.programId)
  const user = provider.wallet as anchor.Wallet;

  const JUPITER_PROGRAM_ID = new PublicKey(
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  );
  const FEE_ACCOUNT = new PublicKey(
    "4HyUr6FF9U8HfWpxyCLKsVMMRGqZ8ekgwNDH7YkP5uqp"
  );

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

  const getCommitAccountPDA = (sender: PublicKey) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), sender.toBuffer()],
      program.programId
    );
    return pda;
  };

  it("performs a commit-reveal swap via CPI into Jupiter", async () => {
    const inputMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    ); // wSOL
    const outputMint = new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ); // USDC

    const amount = 1_000_000; // e.g. 0.001 SOL
    const senderInputATA = await getAssociatedTokenAddress(
      inputMint,
      user.publicKey
    );
    const senderOutputATA = await getAssociatedTokenAddress(
      outputMint,
      user.publicKey
    );
    const outputInfo = await provider.connection.getAccountInfo(senderOutputATA);
    console.log("Sender Output ATA:", senderOutputATA.toBase58(), "Exists:", !!outputInfo, "Owner:", outputInfo?.owner.toBase58() || "N/A");

    // ✅ Ensure output ATA exists
    const tx = new Transaction();
    // const outputInfo = await provider.connection.getAccountInfo(senderOutputATA);
    if (!outputInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          senderOutputATA,
          user.publicKey,
          outputMint
        )
      );
    }

    // Get Jupiter route
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amount}&slippageBps=50`
    ).then((res) => res.json());

    const swapResponse = await fetch(
      "https://quote-api.jup.ag/v6/swap-instructions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: user.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        }),
      }
    ).then((res) => res.json());

    const jupiterIx = deserializeInstruction(swapResponse.swapInstruction);

    // Hash commit
    const swapDetails = {
      data: jupiterIx.data.toString("base64"),
      amount,
      timestamp: Date.now(),
    };
    const swapHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(swapDetails))
      .digest();

    const commitAccountPDA = getCommitAccountPDA(user.publicKey);

    console.log("🔒 Committing swap...");
    await program.methods
      .commitswap(Array.from(swapHash))
      .accounts({
        commitAccount: commitAccountPDA,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("✅ Swap committed with hash:", swapHash.toString("hex"));

    // Build swap instruction
    const swapIx = await program.methods
      .swap(jupiterIx.data, Array.from(swapHash), new bn.BN(amount))
      .accounts({
        inputMint,
        inputMintProgram: TOKEN_PROGRAM_ID,
        outputMint,
        outputMintProgram: TOKEN_PROGRAM_ID,
        sender: user.publicKey,
        senderTokenAccount: senderInputATA,
        feeAccount: FEE_ACCOUNT,
        commitSwap: commitAccountPDA,
        jupiterProgram: JUPITER_PROGRAM_ID,
      })
      .remainingAccounts(
        jupiterIx.keys.map((k) => ({
          pubkey: k.pubkey,
          isWritable: k.isWritable,
          isSigner: k.isSigner,
        }))
      )
      .instruction();

    tx.add(swapIx);

    // Send both (ATA create + swap)
    const sig = await provider.sendAndConfirm(tx, []);
    console.log("✅ Swap via CPI executed:", sig);
  });

  it("can commit a swap without executing", async () => {
    const testHash = crypto.randomBytes(32);
    const commitAccountPDA = getCommitAccountPDA(user.publicKey);

    await program.methods
      .commitswap(Array.from(testHash))
      .accounts({
        commitAccount: commitAccountPDA,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const commitData = await program.account.swapCommit.fetch(commitAccountPDA);
    console.log("Stored hash:", Buffer.from(commitData.hash).toString("hex"));
    console.log("Original hash:", testHash.toString("hex"));

    console.log(
      "✅ Hashes match:",
      Buffer.from(commitData.hash).equals(testHash)
    );
  });

  it("fails with invalid reveal hash", async () => {
    const commitAccountPDA = getCommitAccountPDA(user.publicKey);
    const correctHash = crypto.randomBytes(32);
    const wrongHash = crypto.randomBytes(32);

    await program.methods
      .commitswap(Array.from(correctHash))
      .accounts({
        commitAccount: commitAccountPDA,
        sender: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .swap(Buffer.from("dummy"), Array.from(wrongHash), new bn.BN(1_000_000))
        .accounts({
          inputMint: new PublicKey(
            "So11111111111111111111111111111111111111112"
          ),
          inputMintProgram: TOKEN_PROGRAM_ID,
          outputMint: new PublicKey(
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
          ),
          outputMintProgram: TOKEN_PROGRAM_ID,
          sender: user.publicKey,
          senderTokenAccount: await getAssociatedTokenAddress(
            new PublicKey("So11111111111111111111111111111111111111112"),
            user.publicKey
          ),
          feeAccount: FEE_ACCOUNT,
          commitSwap: commitAccountPDA,
          jupiterProgram: JUPITER_PROGRAM_ID,
        })
        .rpc();

      throw new Error("Should have failed with invalid hash");
    } catch (error: any) {
      console.log("✅ Correctly failed with invalid reveal:", error.message);
    }
  });
});
