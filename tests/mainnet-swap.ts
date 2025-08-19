import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { CpiSwapProgram } from "../target/types/cpi_swap_program.ts";
import { describe, before, it } from "node:test";

describe("cpi_swap_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CpiSwapProgram as Program<CpiSwapProgram>;
  const user = provider.wallet as anchor.Wallet;

  const JUPITER_PROGRAM_ID = new PublicKey(
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
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

  it("performs a swap via CPI into Jupiter", async () => {
    const inputMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    ); 
    const outputMint = new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ); 

    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=1000000&slippageBps=50`
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
    console.log("swapResponse: ", swapResponse)

    const jupiterIx = deserializeInstruction(swapResponse.swapInstruction);

    await program.methods
      .swap(jupiterIx.data) 
      .accounts({
        inputMint,
        inputMintProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        outputMint,
        outputMintProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        sender: user.publicKey,
        jupiter_program: JUPITER_PROGRAM_ID,
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
});
