# Mainnet Testing Guide

## Prerequisites

1. **Fund your wallet**: Your wallet needs SOL to pay for transaction fees and rent
   ```bash
   # Check current balance
   solana balance -u mainnet-beta
   
   # If you need SOL, you can:
   # - Transfer from an exchange
   # - Use a bridge from another network
   # - Or use mainnet faucets (if available)
   ```

2. **Deploy your program**: Make sure your program is deployed to mainnet
   ```bash
   anchor deploy --provider.cluster mainnet-beta
   ```

## Running Mainnet Tests

### Option 1: Use the script
```bash
./run-mainnet-test.sh
```

### Option 2: Direct commands
```bash
# Build the program
anchor build

# Run only the mainnet test
node test-mainnet-only.js
```

### Option 3: Manual anchor test
```bash
anchor test --provider.cluster mainnet-beta --skip-deploy tests/newTest.ts
```

## What the test does

1. **Checks wallet balance** - Warns if balance is low
2. **Creates token accounts** - Sets up USDC token accounts for sender and fee collection
3. **Commits swap hash** - Uses the commit-reveal pattern for MEV protection
4. **Gets Jupiter quote** - Fetches real market data for SOL -> USDC swap
5. **Executes CPI swap** - Calls Jupiter through your program with fee collection
6. **Verifies results** - Checks that tokens were swapped and fees collected

## Expected costs

- Token account creation: ~0.002 SOL per account
- Transaction fees: ~0.001 SOL per transaction
- Swap amount: 0.01 SOL (configurable in test)
- **Total estimated cost**: ~0.02 SOL

## Troubleshooting

- **"Insufficient SOL balance"**: Fund your wallet with more SOL
- **"Account not found"**: Make sure your program is deployed to mainnet
- **Jupiter API errors**: Check network connectivity and token availability
- **Transaction failures**: May indicate insufficient funds or program logic issues

## Safety Notes

- Tests use small amounts (0.01 SOL) for safety
- All transactions are real and cost real SOL
- Double-check your wallet address before funding
- Consider testing on devnet first if possible