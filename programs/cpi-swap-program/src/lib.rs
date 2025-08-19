use anchor_lang::{
    accounts::signer, prelude::*, solana_program::{instruction::Instruction, program::invoke_signed}
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use jupiter_aggregator::program::Jupiter;
use std::str::FromStr;

declare_program!(jupiter_aggregator);
declare_id!("76j3Mhhr64JU2Lj1FMV1dPErgmJMVgpPcm19nyx1XHDF");
// declare_id!("8KQG1MYXru73rqobftpFjD3hBD8Ab3jaag8wbjZG63sx");

pub fn jupiter_program_id() -> Pubkey {
    Pubkey::from_str("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4").unwrap()
}

#[program]
pub mod cpi_swap_program{
    use anchor_lang::solana_program::program::invoke;

    use super::*;
    pub fn commitswap(ctx:Context<CommitSwap>, swap_hash:[u8;32])->Result<()>{
        ctx.accounts.commit_account.hash = swap_hash;
        Ok(())
    }

    pub fn swap(ctx:Context<Swap>, data:Vec<u8>, hash:[u8;32])->Result<()>{
        require_keys_eq!(*ctx.accounts.jupiter_program.key, jupiter_program_id());

        require!(ctx.accounts.commit_swap.hash==hash, CustomError::InvalidReveal);

        let accounts: Vec<AccountMeta> = ctx.remaining_accounts
            .iter()
            .map(|acc| AccountMeta{
                pubkey: *acc.key,
                is_signer: acc.is_signer,
                is_writable: acc.is_writable
            })
            .collect();

        let accounts_infos: Vec<AccountInfo> = ctx.remaining_accounts
            .iter()
            .map(|acc|AccountInfo {..acc.clone()})
            .collect();
        
        invoke(
            &Instruction { 
                program_id: ctx.accounts.jupiter_program.key(), 
                accounts, 
                data 
            }, &accounts_infos)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Swap<'info>{
    pub input_mint: InterfaceAccount<'info, Mint>,
    pub input_mint_program: Interface<'info, TokenInterface>,
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub output_mint_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub sender: Signer<'info>,
    pub jupiter_program: Program<'info, Jupiter>,

    #[account(mut)]
    pub commit_swap:Account<'info, SwapCommit>
}

#[derive(Accounts)]
pub struct CommitSwap<'info>{
    #[account(init, payer=sender, space=8+32)]
    pub commit_account: Account<'info, SwapCommit>,
    #[account(mut)]
    pub sender: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[account]
pub struct SwapCommit{
    pub hash: [u8; 32]
}

#[error_code]
pub enum CustomError {
    #[msg("The revealed swap details do not match the committed hash.")]
    InvalidReveal,

    #[msg("Jupiter program ID mismatch.")]
    InvalidJupiterProgram,
}