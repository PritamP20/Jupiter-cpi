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
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
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

// =========================
// NETWORK CONFIGURATION
// =========================

// 🔴 MAINNET CONFIGURATION (COMMENTED OUT FOR SAFETY)

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // mainnet USDC
const USDC_TOKEN_PROGRAM = TOKEN_PROGRAM_ID; // mainnet USDC uses standard token program
const NETWORK = "mainnet";


// 🟢 DEVNET CONFIGURATION (ACTIVE)
// const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // devnet USDC
// const USDC_TOKEN_PROGRAM = TOKEN_PROGRAM_ID; // devnet USDC uses Token-2022
// const NETWORK = "devnet";

// Common constants
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // wrapped SOL
const FEE_WALLET = new PublicKey("4HyUr6FF9U8HfWpxyCLKsVMMRGqZ8ekgwNDH7YkP5uqp");

describe("cpi-swap-program", () => {
  // Anchor setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CpiSwapProgram as Program<CpiSwapProgram>;

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  
  console.log("🔗 Network:", NETWORK);
  console.log("💼 Wallet address:", wallet.publicKey.toBase58());
  console.log("🪙 USDC Mint:", USDC_MINT.toBase58());
  console.log("🔧 Token Program:", USDC_TOKEN_PROGRAM.toBase58());

  let feeTokenAccount: PublicKey;
  let senderTokenAccount: PublicKey;
  let commitPda: PublicKey;
  let commitBump: number;

  it("prepare accounts", async () => {
    // Check network connection
    try {
      const genesisHash = await connection.getGenesisHash();
      console.log("🌐 Genesis Hash:", genesisHash);
      
      // Mainnet genesis hash check (commented out for devnet)
      /*
      if (NETWORK === "mainnet" && genesisHash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
        throw new Error("❌ Not connected to mainnet! Please check your RPC endpoint.");
      }
      */
    } catch (error) {
      console.warn("⚠️ Could not verify network connection:", error.message);
    }

    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`💰 Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    const minimumBalance = NETWORK === "mainnet" ? 0.1 : 0.05;
    if (balance < minimumBalance * LAMPORTS_PER_SOL) {
      if (NETWORK === "mainnet") {
        throw new Error(`❌ Insufficient SOL balance for mainnet operations. Need at least ${minimumBalance} SOL`);
      } else {
        console.log(`⚠️ Low SOL balance detected. Consider getting devnet SOL from faucet.`);
        console.log(`💡 Visit: https://faucet.solana.com/`);
      }
    }

    // Derive commit PDA
    [commitPda, commitBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("🔑 Commit PDA:", commitPda.toBase58());

    // Get Associated Token Addresses
    senderTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      wallet.publicKey,
      false,
      USDC_TOKEN_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    feeTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      FEE_WALLET,
      false,
      USDC_TOKEN_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log("📊 Sender Token Account:", senderTokenAccount.toBase58());
    console.log("💸 Fee Token Account:", feeTokenAccount.toBase58());

    const instructions = [];

    // Check if sender token account exists
    try {
      const senderAccountInfo = await connection.getAccountInfo(senderTokenAccount);
      if (senderAccountInfo) {
        console.log("✅ Sender USDC token account already exists");
        
        // Check token balance
        try {
          const tokenBalance = await connection.getTokenAccountBalance(senderTokenAccount);
          console.log("💵 Current USDC balance:", tokenBalance.value.uiAmountString || "0");
        } catch (e) {
          console.log("⚠️ Could not fetch token balance");
        }
      } else {
        throw new Error("Account not found");
      }
    } catch {
      console.log("🔨 Creating sender USDC token account...");
      const senderAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer
        senderTokenAccount, // ata
        wallet.publicKey, // owner
        USDC_MINT, // mint
        USDC_TOKEN_PROGRAM,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(senderAtaIx);
    }

    // Check if fee token account exists
    try {
      const feeAccountInfo = await connection.getAccountInfo(feeTokenAccount);
      if (feeAccountInfo) {
        console.log("✅ Fee USDC token account already exists");
      } else {
        throw new Error("Account not found");
      }
    } catch {
      console.log("🔨 Creating fee USDC token account...");
      const feeAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer
        feeTokenAccount, // ata
        FEE_WALLET, // owner
        USDC_MINT, // mint
        USDC_TOKEN_PROGRAM,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(feeAtaIx);
    }

    // Execute token account creation if needed
    if (instructions.length > 0) {
      const estimatedCost = instructions.length * 0.00204;
      console.log(`💰 Creating ${instructions.length} token account(s) - estimated cost: ~${estimatedCost} SOL`);

      try {
        const tx = new Transaction().add(...instructions);
        const signature = await provider.sendAndConfirm(tx, []);
        console.log("✅ Token accounts created successfully");
        console.log("🔗 Transaction signature:", signature);
      } catch (error) {
        console.error("❌ Transaction failed:", error);

        if (error.logs) {
          console.log("📜 Transaction logs:", error.logs);
        }

        // Provide helpful error messages
        if (error.message.includes("0x2") || error.message.includes("Invalid Mint")) {
          console.log("💡 Hint: This might be a token program mismatch. Check if the mint uses Token Program or Token-2022 Program.");
        }

        throw error;
      }
    } else {
      console.log("✅ All token accounts already exist - no SOL spent!");
    }
  });

  it("commit swap", async () => {
    console.log("🔒 Running commit swap...");
    const swapHash = new Uint8Array(32).fill(1); // dummy hash for testing
    
    try {
      const signature = await program.methods
        .commitswap([...swapHash])
        .accounts({
          commitAccount: commitPda,
          sender: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log("✅ Commit swap successful");
      console.log("🔗 Transaction signature:", signature);
    } catch (error) {
      console.error("❌ Commit swap failed:", error);
      throw error;
    }
  });

  it("swap SOL -> USDC through Jupiter", async () => {
    try {
      console.log("🚀 Starting Jupiter swap...");
      
      // Use appropriate swap amount based on network
      const swapAmount = NETWORK === "mainnet" ? 0.01 * LAMPORTS_PER_SOL : 0.01 * LAMPORTS_PER_SOL;
      console.log(`💱 Swapping ${swapAmount / LAMPORTS_PER_SOL} SOL -> USDC`);

      // === STEP 1: Get route from Jupiter API ===
      console.log("📡 Getting quote from Jupiter...");
      const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=${swapAmount}&slippageBps=50`;
      
      const quoteRes = await fetch(quoteUrl);

      if (!quoteRes.ok) {
        const errorText = await quoteRes.text();
        console.error("❌ Jupiter API error response:", errorText);
        throw new Error(`Jupiter quote API failed: ${quoteRes.status}`);
      }

      const quote = await quoteRes.json();
      console.log("✅ Quote received. Expected output:", quote.outAmount);

      // === STEP 2: Get serialized swap instructions ===
      console.log("🔧 Getting swap instructions...");
      const swapIxRes = await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          useVersionedTransaction: true, // Enable versioned transactions
        }),
      });

      if (!swapIxRes.ok) {
        const errorText = await swapIxRes.text();
        console.error("❌ Jupiter swap instruction API error:", errorText);
        throw new Error(`Jupiter swap instruction API failed: ${swapIxRes.status}`);
      }

      const swapResponse = await swapIxRes.json();
      console.log("✅ Swap instructions received");
      console.log("📊 Setup instructions count:", swapResponse.setupInstructions?.length || 0);
      console.log("📊 Lookup tables count:", swapResponse.addressLookupTableAddresses?.length || 0);

      const { swapInstruction, setupInstructions, computeBudgetInstructions } = swapResponse;

      // === STEP 3: Build our program instruction ===
      console.log("🔧 Building CPI swap instruction...");
      const swapHash = new Uint8Array(32).fill(1); // must match commit

      const swapIx = await program.methods
        .swap(
          Buffer.from(swapInstruction.data, "base64"),
          [...swapHash],
          new BN(swapAmount)
        )
        .accounts({
          inputMint: SOL_MINT,
          inputMintProgram: TOKEN_PROGRAM_ID, // SOL always uses standard token program
          outputMint: USDC_MINT,
          outputMintProgram: USDC_TOKEN_PROGRAM, // Use the configured token program
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
        .instruction();

      // === STEP 4: Build complete instruction array ===
      const instructions = [];

      // Add compute budget instructions first
      if (computeBudgetInstructions && computeBudgetInstructions.length > 0) {
        for (const ix of computeBudgetInstructions) {
          instructions.push({
            programId: new PublicKey(ix.programId),
            keys: ix.accounts?.map((acc: any) => ({
              pubkey: new PublicKey(acc.pubkey),
              isWritable: acc.isWritable,
              isSigner: acc.isSigner,
            })) || [],
            data: Buffer.from(ix.data, "base64"),
          });
        }
      }

      // Add setup instructions
      if (setupInstructions && setupInstructions.length > 0) {
        for (const ix of setupInstructions) {
          instructions.push({
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

      // Add our swap instruction
      instructions.push(swapIx);

      console.log(`📦 Total instructions: ${instructions.length}`);

      // === STEP 5: Handle address lookup tables ===
      const addressLookupTableAccounts: AddressLookupTableAccount[] = [];
      if (swapResponse.addressLookupTableAddresses?.length > 0) {
        console.log("🔍 Fetching address lookup tables...");
        for (const address of swapResponse.addressLookupTableAddresses) {
          try {
            const lookupTableAccount = await connection
              .getAddressLookupTable(new PublicKey(address))
              .then(res => res.value);
            if (lookupTableAccount) {
              addressLookupTableAccounts.push(lookupTableAccount);
            }
          } catch (error) {
            console.warn(`⚠️ Failed to fetch lookup table ${address}:`, error.message);
          }
        }
        console.log(`✅ Loaded ${addressLookupTableAccounts.length} lookup tables`);
      }

      // === STEP 6: Create and send versioned transaction ===
      console.log("📤 Creating versioned transaction...");
      const { blockhash } = await connection.getLatestBlockhash();
      
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(addressLookupTableAccounts);

      const transaction = new VersionedTransaction(messageV0);

      // Get transaction size
      const serializedSize = transaction.serialize().length;
      console.log(`📏 Transaction size: ${serializedSize} bytes`);

      if (serializedSize > 1232) {
        console.warn("⚠️ Transaction is large but should work with versioned transactions");
      }

      console.log("📤 Sending transaction...");
      const signature = await provider.sendAndConfirm(transaction, [], {
        commitment: "confirmed",
        maxRetries: 3,
      });

      console.log("✅ Swap completed successfully!");
      console.log("🔗 Transaction signature:", signature);

      // === STEP 7: Check final balances ===
      console.log("📊 Checking final balances...");
      
      try {
        const senderUsdcAcc = await connection.getTokenAccountBalance(senderTokenAccount);
        console.log("💵 Final USDC balance:", senderUsdcAcc.value.uiAmountString || "0");

        const feeAccBal = await connection.getTokenAccountBalance(feeTokenAccount);
        console.log("💸 Fee account balance:", feeAccBal.value.uiAmountString || "0");
      } catch (balanceError) {
        console.warn("⚠️ Could not fetch final balances:", balanceError.message);
      }

      const finalSolBalance = await connection.getBalance(wallet.publicKey);
      console.log(`💰 Final SOL balance: ${finalSolBalance / LAMPORTS_PER_SOL} SOL`);

    } catch (error) {
      console.error("❌ Jupiter swap test failed:", error);
      
      // Provide helpful debugging information
      if (error.message.includes("0xbbf") || error.message.includes("AccountOwnedByWrongProgram")) {
        console.log("💡 Hint: Token program mismatch. Make sure outputMintProgram matches the mint's actual program.");
        console.log(`🔧 Current config: ${USDC_TOKEN_PROGRAM.toBase58()}`);
        console.log(`🪙 USDC Mint: ${USDC_MINT.toBase58()}`);
      }
      
      if (error.message.includes("Transaction too large")) {
        console.log("💡 Hint: Try using versioned transactions or reducing instruction count.");
      }
      
      if (error.logs) {
        console.log("📜 Transaction logs:", error.logs);
      }
      
      throw error;
    }
  });
});

// =========================
// HELPER FUNCTIONS
// =========================

// Function to switch between networks (for future use)
function getNetworkConfig(network: "mainnet" | "devnet") {
  if (network === "mainnet") {
    return {
      usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      usdcTokenProgram: TOKEN_PROGRAM_ID,
      minBalance: 0.1,
    };
  } else {
    return {
      usdcMint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
      usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
      minBalance: 0.05,
    };
  }
}

/*
=========================
NETWORK SWITCHING GUIDE
=========================

TO SWITCH TO MAINNET:
1. Comment out the DEVNET CONFIGURATION section
2. Uncomment the MAINNET CONFIGURATION section
3. Update your Anchor.toml to use mainnet RPC:
   [provider]
   cluster = "mainnet"
   wallet = "~/.config/solana/id.json"

4. Make sure you have sufficient SOL for mainnet operations (at least 0.1 SOL)
5. Double-check all addresses and be cautious with real funds!

CURRENT SETUP: DEVNET (SAFE FOR TESTING)
- Uses devnet USDC mint with Token-2022 Program
- Lower minimum balance requirement
- Safe for testing without risking real funds

⚠️  MAINNET WARNING ⚠️ 
When switching to mainnet:
- You'll be using real SOL and real tokens
- Test thoroughly on devnet first
- Start with very small amounts
- Double-check all addresses and configurations
*/