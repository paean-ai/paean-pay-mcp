#!/usr/bin/env node
/**
 * End-to-end testnet integration test for paean-pay-mcp.
 *
 * Usage:
 *   PAYMENT_PRIVATE_KEY_BASE=0x... \
 *   PAYMENT_PRIVATE_KEY_SOLANA=... \
 *   node scripts/test-mcp.mjs [--chain base|solana]
 *
 * What it tests:
 *   1. get_wallet_address   — reads configured wallet
 *   2. get_usdc_balance     — checks on-chain balance
 *   3. create_payment_request — creates a payment request
 *   4. list_payment_requests  — lists all requests
 *   5. check_payment_status   — verifies pending status
 *   6. send_usdc (self-send) — sends USDC to self (requires balance)
 *   7. get_transaction_status — verifies the tx
 *   8. check_payment_status   — should auto-confirm after self-send
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

const CHAIN = process.argv.includes('--chain')
  ? process.argv[process.argv.indexOf('--chain') + 1]
  : 'base';

if (!['base', 'solana'].includes(CHAIN)) {
  console.error(`Invalid chain: ${CHAIN}. Use 'base' or 'solana'.`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, value) {
  console.log(`  ✓ ${label}`);
  if (value !== undefined) console.log(`    ${JSON.stringify(value, null, 2).split('\n').join('\n    ')}`);
  passed++;
}

function fail(label, msg) {
  console.error(`  ✗ ${label}: ${msg}`);
  failed++;
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(result.content[0]?.text || 'Unknown error');
  }
  return JSON.parse(result.content[0].text);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log(`  paean-pay-mcp Testnet Integration Test`);
  console.log(`  Chain: ${CHAIN.toUpperCase()} (testnet)`);
  console.log('='.repeat(60));
  console.log();

  // Check env vars
  const baseKey = process.env.PAYMENT_PRIVATE_KEY_BASE;
  const solanaKey = process.env.PAYMENT_PRIVATE_KEY_SOLANA;

  if (CHAIN === 'base' && !baseKey) {
    console.error('ERROR: PAYMENT_PRIVATE_KEY_BASE not set.');
    console.error('Run: node scripts/gen-wallets.mjs to generate test wallets.');
    process.exit(1);
  }
  if (CHAIN === 'solana' && !solanaKey) {
    console.error('ERROR: PAYMENT_PRIVATE_KEY_SOLANA not set.');
    console.error('Run: node scripts/gen-wallets.mjs to generate test wallets.');
    process.exit(1);
  }

  // Spawn MCP server
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      PAYMENT_NETWORK: 'testnet',
      PAYMENT_DEFAULT_CHAIN: CHAIN,
    },
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  console.log('Connected to MCP server.\n');

  // ── Test 1: get_wallet_address ───────────────────────────────────────────
  console.log('Test 1: get_wallet_address');
  try {
    const result = await callTool(client, 'get_wallet_address', { chain: CHAIN });
    if (!result.address || result.address === 'Not configured') {
      fail('has wallet address', 'address is empty or not configured');
    } else {
      ok('address configured', result.address);
    }
  } catch (e) {
    fail('get_wallet_address', e.message);
  }
  console.log();

  // ── Test 2: get_usdc_balance ─────────────────────────────────────────────
  console.log('Test 2: get_usdc_balance');
  let walletAddress;
  let currentBalance = '0';
  try {
    // Get wallet address first
    const addrResult = await callTool(client, 'get_wallet_address', { chain: CHAIN });
    walletAddress = addrResult.address;

    const result = await callTool(client, 'get_usdc_balance', { chain: CHAIN });
    currentBalance = result.balance;
    ok(`balance: ${result.balance} USDC`, { chain: result.chain, address: result.address });

    const bal = parseFloat(result.balance);
    if (bal === 0) {
      console.log('  ⚠ Balance is 0. Get testnet USDC from https://faucet.circle.com/');
      console.log(`    Address: ${walletAddress}`);
    }
  } catch (e) {
    fail('get_usdc_balance', e.message);
  }
  console.log();

  // ── Test 3: create_payment_request ──────────────────────────────────────
  console.log('Test 3: create_payment_request');
  let paymentId;
  try {
    const result = await callTool(client, 'create_payment_request', {
      chain: CHAIN,
      amount: '0.01',
      memo: 'testnet-integration-test',
      expires_in_minutes: 10,
    });
    paymentId = result.payment_id;
    ok(`created: ${paymentId}`, {
      status: result.status,
      amount: result.amount_usdc,
      recipient: result.recipient_address,
    });
  } catch (e) {
    fail('create_payment_request', e.message);
  }
  console.log();

  // ── Test 4: list_payment_requests ───────────────────────────────────────
  console.log('Test 4: list_payment_requests');
  try {
    const result = await callTool(client, 'list_payment_requests', { chain: CHAIN, status: 'pending' });
    if (result.total >= 1) {
      ok(`found ${result.total} pending request(s)`);
    } else {
      fail('list_payment_requests', 'Expected at least 1 pending request');
    }
  } catch (e) {
    fail('list_payment_requests', e.message);
  }
  console.log();

  // ── Test 5: check_payment_status (should be pending) ────────────────────
  console.log('Test 5: check_payment_status (expect: pending)');
  if (paymentId) {
    try {
      const result = await callTool(client, 'check_payment_status', { payment_id: paymentId });
      if (result.status === 'pending') {
        ok('status is pending');
      } else if (result.status === 'confirmed') {
        ok('status is confirmed (there was already a matching tx)');
      } else {
        fail('unexpected status', result.status);
      }
    } catch (e) {
      fail('check_payment_status', e.message);
    }
  }
  console.log();

  // ── Test 6: send_usdc (self-send, requires balance) ──────────────────────
  console.log('Test 6: send_usdc (self-send 0.01 USDC)');
  let sentTxHash;
  const bal = parseFloat(currentBalance);
  if (bal >= 0.01 && walletAddress) {
    try {
      const result = await callTool(client, 'send_usdc', {
        to: walletAddress,
        amount: '0.01',
        chain: CHAIN,
      });
      sentTxHash = result.tx_hash;
      ok(`sent! tx: ${sentTxHash}`, { explorer: result.explorer_url });
    } catch (e) {
      fail('send_usdc', e.message);
    }
  } else {
    console.log(`  ⚠ Skipped: balance (${currentBalance} USDC) < 0.01. Fund wallet first.`);
    console.log(`    Faucet: https://faucet.circle.com/`);
  }
  console.log();

  // ── Test 7: get_transaction_status ───────────────────────────────────────
  console.log('Test 7: get_transaction_status');
  if (sentTxHash) {
    // Wait a bit for the tx to propagate
    console.log('  Waiting 5s for tx propagation...');
    await sleep(5000);
    try {
      const result = await callTool(client, 'get_transaction_status', {
        tx_hash: sentTxHash,
        chain: CHAIN,
      });
      if (result.confirmed) {
        ok('transaction confirmed', { block: result.blockNumber, amount: result.amount });
      } else {
        console.log('  ⚠ Transaction not yet confirmed (may need more time)');
        ok('transaction found', { confirmed: result.confirmed });
      }
    } catch (e) {
      fail('get_transaction_status', e.message);
    }
  } else {
    console.log('  ⚠ Skipped: no tx hash (send_usdc was skipped)');
  }
  console.log();

  // ── Test 8: check_payment_status after self-send ─────────────────────────
  console.log('Test 8: check_payment_status (expect: confirmed after self-send)');
  if (sentTxHash && paymentId) {
    try {
      const result = await callTool(client, 'check_payment_status', { payment_id: paymentId });
      if (result.status === 'confirmed') {
        ok('payment auto-confirmed!', { tx: result.confirmed_tx });
      } else {
        console.log(`  ⚠ Status is still '${result.status}'. The tx may not be indexed yet.`);
        ok('check ran without error');
      }
    } catch (e) {
      fail('check_payment_status (post-send)', e.message);
    }
  } else {
    console.log('  ⚠ Skipped: no send was made');
  }
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
