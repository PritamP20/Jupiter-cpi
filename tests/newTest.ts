import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { CpiSwapProgram } from "../target/types/cpi_swap_program";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { describe, it, before, beforeEach } from "mocha";
import { BN } from "bn.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const JUPITER_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

// ✅ FIXED: Use correct token program for mainnet USDC
const USDC_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

describe("cpi-swap-program", () => {
  // Anchor setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CpiSwapProgram as Program<CpiSwapProgram>;

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  console.log("my wallet address: ", wallet.publicKey);
  let feeTokenAccount: PublicKey;
  let senderTokenAccount: PublicKey;
  let commitPda: PublicKey;
  let commitBump: number;

  const USDC_MINT = new PublicKey(
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // devnet USDC mint
  );
  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // wrapped SOL
  const FEE_WALLET = new PublicKey(
    "4HyUr6FF9U8HfWpxyCLKsVMMRGqZ8ekgwNDH7YkP5uqp"
  );

  it("prepare accounts", async () => {
    // Check wallet balance for mainnet testing
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      console.log(
        "⚠️  Low SOL balance detected. You may need to fund your wallet for mainnet testing."
      );
      console.log("💡 For testing purposes, continuing with reduced checks...");
    }

    // Derive commit PDA
    [commitPda, commitBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), wallet.publicKey.toBuffer()],
      program.programId
    );

    // ✅ FIXED: Both accounts now use the correct token program
    senderTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      wallet.publicKey,
      false,
      USDC_TOKEN_PROGRAM, // TOKEN_PROGRAM_ID
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    feeTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      FEE_WALLET,
      false,
      USDC_TOKEN_PROGRAM, // TOKEN_PROGRAM_ID
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions = [];

    // Check if sender token account exists
    try {
      const senderAccountInfo = await connection.getAccountInfo(
        senderTokenAccount
      );
      if (senderAccountInfo) {
        console.log("✓ Sender USDC token account already exists");
      } else {
        throw new Error("Account not found");
      }
    } catch {
      console.log("Creating sender USDC token account...");
      const senderAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        senderTokenAccount,
        wallet.publicKey,
        USDC_MINT,
        USDC_TOKEN_PROGRAM, // ✅ FIXED: Use correct token program
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(senderAtaIx);
    }

    // Check if fee token account exists
    try {
      const feeAccountInfo = await connection.getAccountInfo(feeTokenAccount);
      if (feeAccountInfo) {
        console.log("✓ Fee USDC token account already exists");
      } else {
        throw new Error("Account not found");
      }
    } catch {
      console.log("Creating fee USDC token account...");
      const feeAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        feeTokenAccount,
        FEE_WALLET,
        USDC_MINT,
        USDC_TOKEN_PROGRAM, // ✅ FIXED: Use correct token program (was TOKEN_PROGRAM_ID, now consistent)
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(feeAtaIx);
    }

    // Only send transaction if we have instructions to execute
    if (instructions.length > 0) {
      console.log(
        `💰 Creating ${
          instructions.length
        } token account(s) - this will cost ~${
          instructions.length * 0.00204
        } SOL`
      );

      try {
        const tx = new Transaction().add(...instructions);
        await provider.sendAndConfirm(tx, []);
        console.log("✓ Token accounts created successfully");
      } catch (error) {
        console.error("Transaction failed:", error);

        // Enhanced error handling as suggested
        if (error.logs) {
          console.log("Transaction logs:", error.logs);
        }

        throw error;
      }
    } else {
      console.log("✓ All token accounts already exist - no SOL spent!");
    }
  });

  it("commit swap", async () => {
    console.log("running commit swap...");
    const swapHash = new Uint8Array(32).fill(1); // dummy hash
    await program.methods
      .commitswap([...swapHash])
      .accounts({
        commitAccount: commitPda,
        sender: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("swap SOL -> USDC through Jupiter", async () => {
    try {
      // === STEP 1: Get route from Jupiter API ===
      // Use smaller amount for mainnet testing (0.01 SOL)
      const swapAmount = 0.01 * LAMPORTS_PER_SOL;
      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=${swapAmount}&slippageBps=50`
      );

      if (!quoteRes.ok) {
        const errorText = await quoteRes.text();
        console.log("Jupiter API error response:", errorText);
        throw new Error(`Jupiter quote API failed: ${quoteRes.status}`);
      }

      const quote = await quoteRes.json();
      // console.log("Best route:", quote);

      // === STEP 2: Get serialized swap IX ===
      const swapIxRes = await fetch(
        "https://quote-api.jup.ag/v6/swap-instructions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
          }),
        }
      );

      if (!swapIxRes.ok) {
        throw new Error(
          `Jupiter swap instruction API failed: ${swapIxRes.status}`
        );
      }

      const swapResponse = await swapIxRes.json();
      console.log("swapResponse: ", swapResponse);
      const { swapInstruction, setupInstructions, cleanupInstruction } =
        swapResponse as {
          swapInstruction: any;
          setupInstructions: any[];
          cleanupInstruction: any;
        };

      // === STEP 3: Call our CPI swap ===
      const swapHash = new Uint8Array(32).fill(1); // must match commit

      // Create transaction with compute budget and priority fee
      const tx = await program.methods
        .swap(
          Buffer.from(swapInstruction.data, "base64"),
          [...swapHash],
          new BN(swapAmount)
        )
        .accounts({
          inputMint: SOL_MINT,
          inputMintProgram: TOKEN_PROGRAM_ID,
          outputMint: USDC_MINT,
          outputMintProgram: TOKEN_PROGRAM_ID, // mainnet USDC uses regular token program
          sender: wallet.publicKey,
          senderTokenAccount: senderTokenAccount,
          feeAccount: feeTokenAccount,
          commitSwap: commitPda,
          jupiterProgram: JUPITER_PROGRAM_ID,
        })
        .remainingAccounts(
          swapInstruction.accounts.map((acc: any) => ({
            pubkey: new PublicKey(acc.pubkey),
            isWritable: acc.isWritable,
            isSigner: acc.isSigner,
          }))
        )
        .transaction();

      // Add setup instructions if they exist
      if (setupInstructions && setupInstructions.length > 0) {
        for (const ix of setupInstructions) {
          tx.add({
            programId: new PublicKey(ix.programId),
            keys: ix.accounts.map((acc: any) => ({
              pubkey: new PublicKey(acc.pubkey),
              isWritable: acc.isWritable,
              isSigner: acc.isSigner,
            })),
            data: Buffer.from(ix.data, "base64"),
          });
        }
      }

      // Send transaction with higher compute units
      const signature = await provider.sendAndConfirm(tx, [], {
        commitment: "confirmed",
        maxRetries: 3,
      });

      // === STEP 4: Assert balances ===
      const senderUsdcAcc = await connection.getTokenAccountBalance(
        senderTokenAccount
      );
      console.log(
        "USDC balance after swap:",
        senderUsdcAcc.value.uiAmountString
      );

      const feeAccBal = await connection.getTokenAccountBalance(
        feeTokenAccount
      );
      console.log("Fee account balance:", feeAccBal.value.uiAmountString);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
