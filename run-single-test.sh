#!/bin/bash

echo "🚀 Running Single Mainnet Test"
echo "=============================="
echo ""

# Check wallet balance
echo "Wallet address: $(solana address)"
echo "Checking wallet balance..."
solana balance -u mainnet-beta

echo ""
echo "Building program..."
anchor build

echo ""
echo "Setting up environment for mainnet..."
export ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com"

echo "Running ONLY newTest.ts..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/newTest.ts

echo ""
echo "✅ Single test completed!"