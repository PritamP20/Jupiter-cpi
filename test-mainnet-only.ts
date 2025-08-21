// Simple test runner for mainnet-only testing
import { spawn } from 'child_process';

console.log('🚀 Running Mainnet CPI Swap Test');
console.log('==================================');
console.log('Running: tests/newTest.ts');
console.log();

const child = spawn('npx', [
  'ts-mocha',
  '-p', './tsconfig.json',
  '-t', '1000000',
  'tests/newTest.ts'
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ANCHOR_PROVIDER_URL: 'https://api.mainnet-beta.solana.com'
  }
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ Mainnet test completed successfully!');
  } else {
    console.log(`\n❌ Test failed with exit code: ${code}`);
    process.exit(code || 1);
  }
});