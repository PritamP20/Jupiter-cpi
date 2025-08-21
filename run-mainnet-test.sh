#!/bin/bash

echo "🚀 Starting Mainnet CPI Swap Test"
echo "=================================="

# Check if wallet has SOL
echo "Checking wallet balance..."
solana balance -u mainnet-beta

echo ""
echo "Building program..."
anchor build

echo ""
echo "Running mainnet tests..."
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com anchor run test-mainnet --config-file Anchor.mainnet.toml

echo ""
echo "✅ Mainnet test completed!"