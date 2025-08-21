use anchor_lang::{
    accounts::signer, prelude::*, solana_program::{instruction::Instruction, program::invoke}
};
use anchor_spl::token::{self, Transfer, TokenAccount, Token};
use anchor_spl::token_interface::{Mint, TokenInterface};
use jupiter_aggregator::program::Jupiter;
use std::str::FromStr;

declare_program!(jupiter_aggregator);
declare_id!("6bgtV78wMiuaTELQmXs1MxgFeF2uyT6kVCyyxLPzfL3H");

pub fn jupiter_program_id() -> Pubkey {
    Pubkey::from_str("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4").unwrap()
}

#[program]
pub mod cpi_swap_program {
    use super::*;

    pub fn commitswap(ctx: Context<CommitSwap>, swap_hash: [u8;32]) -> Result<()> {
        ctx.accounts.commit_account.hash = swap_hash;
        ctx.accounts.commit_account.used = false;
        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, data: Vec<u8>, hash: [u8;32], amount: u64) -> Result<()> {
        require_keys_eq!(*ctx.accounts.jupiter_program.key, jupiter_program_id(), CustomError::InvalidJupiterProgram);
        require!(ctx.accounts.commit_swap.hash == hash, CustomError::InvalidReveal);
        require!(ctx.accounts.commit_swap.used==false, CustomError::CommitUserAlready);

        let fee_amount = std::cmp::max(1, amount / 1000);
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.fee_account.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        };
        let cpi_program = ctx.accounts.input_mint_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, fee_amount)?;

        let accounts: Vec<AccountMeta> = ctx.remaining_accounts
            .iter()
            .map(|acc| AccountMeta{
                pubkey: *acc.key,
                is_signer: acc.is_signer,
                is_writable: acc.is_writable,
            })
            .collect();

        let accounts_infos: Vec<AccountInfo> = ctx.remaining_accounts
            .iter()
            .map(|acc| AccountInfo { ..acc.clone() })
            .collect();

        invoke(
            &Instruction {
                program_id: ctx.accounts.jupiter_program.key(),
                accounts,
                data,
            },
            &accounts_infos
        )?;
        ctx.accounts.commit_swap.used = true;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub input_mint: InterfaceAccount<'info, Mint>,
    pub input_mint_program: Interface<'info, TokenInterface>,
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub output_mint_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub sender: Signer<'info>,
    
    #[account(mut)]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub fee_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"commit", sender.key().as_ref()],
        bump
    )]
    pub commit_swap: Account<'info, SwapCommit>,

    pub jupiter_program: Program<'info, Jupiter>,
}

#[derive(Accounts)]
pub struct CommitSwap<'info> {
    #[account(
        init_if_needed,
        payer = sender, 
        space = 8+32+1,
        seeds = [b"commit", sender.key().as_ref()],
        bump
    )]
    pub commit_account: Account<'info, SwapCommit>,
    #[account(mut)]
    pub sender: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct SwapCommit {
    pub hash: [u8;32],
    pub used: bool
}

#[error_code]
pub enum CustomError {
    #[msg("The revealed swap details do not match the committed hash.")]
    InvalidReveal,

    #[msg("Jupiter program ID mismatch.")]
    InvalidJupiterProgram,

    #[msg("Commit used already!!")]
    CommitUserAlready
}
