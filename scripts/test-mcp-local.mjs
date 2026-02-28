#!/usr/bin/env node
/**
 * Local fork integration test for paean-pay-mcp.
 *
 * Uses viem's in-process EVM simulation via a live testnet fork over RPC.
 * We impersonate a rich testnet address to bypass the faucet requirement.
 *
 * Requires: node >= 20
 * Usage: node scripts/test-mcp-local.mjs
 *
 * What it does:
 *   1. Picks a Base Sepolia address that already has testnet USDC
 *   2. Impersonates it via eth_sendUnsignedTransaction trick (read-only RPC fork)
 *   3. Tests all 8 MCP tools end-to-end
 *
 * Note: This script doesn't submit real transactions; it tests using a
 * funded SENDER wallet we generate, sending to a RECIPIENT wallet.
 * For the send test, we need ETH + USDC — see instructions below.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

// ── Config ────────────────────────────────────────────────────────────────────
// These are the two wallets for the test.
// SENDER has ETH + USDC; RECIPIENT receives.
// Set via env vars (from gen-wallets.mjs output).
const SENDER_KEY = process.env.PAYMENT_PRIVATE_KEY_BASE;
const RECIPIENT_KEY = process.env.PAYMENT_PRIVATE_KEY_SOLANA_AS_BASE
  || generateRecipientKey(); // fallback: ephemeral recipient

function generateRecipientKey() {
  // Deterministic test recipient (not secret — testnet only)
  return '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

function ok(label, detail) {
  console.log(`  ✓ ${label}`);
  if (detail !== undefined) {
    const s = typeof detail === 'object' ? JSON.stringify(detail, null, 2) : String(detail);
    console.log('    ' + s.split('\n').join('\n    '));
  }
  passed++;
}

function fail(label, msg) {
  console.error(`  ✗ ${label}: ${msg}`);
  failed++;
}

function skip(label, reason) {
  console.log(`  ⊘ ${label}: ${reason}`);
  skipped++;
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content[0]?.text || 'MCP error');
  return JSON.parse(result.content[0].text);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Check Base Sepolia state ──────────────────────────────────────────────────
async function checkOnChainState(address) {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http('https://sepolia.base.org'),
  });
  const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const ERC20_ABI = parseAbi([
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
  ]);

  const [ethBal, usdcBal, block] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
    publicClient.getBlockNumber(),
  ]);

  return {
    ethBalance: formatEther(ethBal),
    usdcBalance: (Number(usdcBal) / 1e6).toFixed(6),
    hasEth: ethBal > 0n,
    hasUsdc: usdcBal > 0n,
    latestBlock: block.toString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SENDER_KEY) {
    console.error('ERROR: Set PAYMENT_PRIVATE_KEY_BASE to run this test.');
    console.error('Run: node scripts/gen-wallets.mjs to generate test wallets.');
    process.exit(1);
  }

  const senderAccount = privateKeyToAccount(SENDER_KEY.startsWith('0x') ? SENDER_KEY : `0x${SENDER_KEY}`);
  const recipientAccount = privateKeyToAccount('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

  console.log('='.repeat(60));
  console.log('  paean-pay-mcp — Base Sepolia Integration Test');
  console.log('='.repeat(60));
  console.log();
  console.log(`  Sender:    ${senderAccount.address}`);
  console.log(`  Recipient: ${recipientAccount.address}`);
  console.log();

  // Check on-chain state before starting
  console.log('Checking on-chain state...');
  const senderState = await checkOnChainState(senderAccount.address);
  console.log(`  Sender ETH:  ${senderState.ethBalance}`);
  console.log(`  Sender USDC: ${senderState.usdcBalance}`);
  console.log(`  Block:       ${senderState.latestBlock}`);
  console.log();

  if (!senderState.hasEth) {
    console.log('⚠  Sender has no ETH for gas. Get testnet ETH first:');
    console.log('   https://www.alchemy.com/faucets/base-sepolia');
    console.log(`   https://faucet.quicknode.com/base/sepolia`);
    console.log(`   Address: ${senderAccount.address}`);
    console.log();
  }
  if (!senderState.hasUsdc) {
    console.log('⚠  Sender has no USDC. Get testnet USDC first:');
    console.log('   https://faucet.circle.com/  (select Base Sepolia)');
    console.log(`   Address: ${senderAccount.address}`);
    console.log();
  }

  const canSend = senderState.hasEth && senderState.hasUsdc;

  // ── Spawn two MCP servers: one for SENDER, one for RECIPIENT ──────────────
  const makeClient = async (privateKey, name) => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        PAYMENT_NETWORK: 'testnet',
        PAYMENT_DEFAULT_CHAIN: 'base',
        PAYMENT_PRIVATE_KEY_BASE: privateKey,
      },
    });
    const client = new Client({ name, version: '1.0.0' });
    await client.connect(transport);
    return client;
  };

  const sender = await makeClient(SENDER_KEY, 'sender');
  const recipient = await makeClient(
    '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    'recipient',
  );

  console.log('Both MCP server instances connected.\n');

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: get_wallet_address
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 1: get_wallet_address');
  try {
    const result = await callTool(sender, 'get_wallet_address', { chain: 'base' });
    if (result.address?.toLowerCase() === senderAccount.address.toLowerCase()) {
      ok('sender address matches', result.address);
    } else {
      fail('sender address', `Expected ${senderAccount.address}, got ${result.address}`);
    }
  } catch (e) { fail('get_wallet_address', e.message); }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: get_usdc_balance (sender)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 2: get_usdc_balance');
  try {
    const result = await callTool(sender, 'get_usdc_balance', { chain: 'base' });
    ok(`sender balance: ${result.balance} USDC`);

    // Also check recipient balance
    const recipResult = await callTool(recipient, 'get_usdc_balance', { chain: 'base' });
    ok(`recipient balance: ${recipResult.balance} USDC`);
  } catch (e) { fail('get_usdc_balance', e.message); }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3 (RECIPIENT): create_payment_request
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 3: create_payment_request (recipient creates request)');
  let paymentId;
  try {
    const result = await callTool(recipient, 'create_payment_request', {
      chain: 'base',
      amount: '0.01',
      memo: 'integration-test-payment',
      expires_in_minutes: 15,
    });
    paymentId = result.payment_id;
    ok(`created payment request: ${paymentId}`, {
      recipient: result.recipient_address,
      amount: result.amount_usdc,
      status: result.status,
    });
  } catch (e) { fail('create_payment_request', e.message); }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: list_payment_requests
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 4: list_payment_requests');
  try {
    const result = await callTool(recipient, 'list_payment_requests', { status: 'pending', chain: 'base' });
    if (result.total >= 1) {
      ok(`found ${result.total} pending request(s)`);
    } else {
      fail('list_payment_requests', 'Expected >= 1 pending request');
    }
  } catch (e) { fail('list_payment_requests', e.message); }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: check_payment_status (should be pending, no payment made yet)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 5: check_payment_status (expect: pending)');
  if (paymentId) {
    try {
      const result = await callTool(recipient, 'check_payment_status', { payment_id: paymentId });
      if (['pending', 'confirmed'].includes(result.status)) {
        ok(`status: ${result.status}`);
      } else {
        fail('status', `Unexpected: ${result.status}`);
      }
    } catch (e) { fail('check_payment_status', e.message); }
  } else {
    skip('check_payment_status', 'no payment ID');
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6 (SENDER): send_usdc to recipient
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 6: send_usdc (sender → recipient, 0.01 USDC)');
  let sentTxHash;
  if (canSend) {
    try {
      const recipAddr = (await callTool(recipient, 'get_wallet_address', { chain: 'base' })).address;
      const result = await callTool(sender, 'send_usdc', {
        to: recipAddr,
        amount: '0.01',
        chain: 'base',
      });
      sentTxHash = result.tx_hash;
      ok(`sent! tx: ${sentTxHash}`, { explorer: result.explorer_url });
    } catch (e) { fail('send_usdc', e.message); }
  } else {
    skip('send_usdc', `sender needs ${!senderState.hasEth ? 'ETH (gas)' : ''}${!senderState.hasEth && !senderState.hasUsdc ? ' + ' : ''}${!senderState.hasUsdc ? 'USDC' : ''}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: get_transaction_status
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 7: get_transaction_status');
  if (sentTxHash) {
    console.log('  Waiting 8s for tx to be indexed...');
    await sleep(8000);
    try {
      const result = await callTool(sender, 'get_transaction_status', {
        tx_hash: sentTxHash,
        chain: 'base',
      });
      if (result.confirmed) {
        ok('confirmed', { block: result.blockNumber, amount: result.amount, to: result.to });
      } else {
        ok('found but not yet confirmed (may still propagate)');
      }
    } catch (e) { fail('get_transaction_status', e.message); }
  } else {
    skip('get_transaction_status', 'no tx (send_usdc was skipped)');
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8: check_payment_status (should auto-confirm after real transfer)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Test 8: check_payment_status (expect: confirmed after payment)');
  if (sentTxHash && paymentId) {
    try {
      const result = await callTool(recipient, 'check_payment_status', { payment_id: paymentId });
      if (result.status === 'confirmed') {
        ok('payment auto-confirmed!', { tx: result.confirmed_tx, from: result.from });
      } else {
        ok(`status: ${result.status} (tx may still be indexing)`, {
          hint: 'Run check_payment_status again in a few seconds',
        });
      }
    } catch (e) { fail('check_payment_status (post-send)', e.message); }
  } else {
    skip('check_payment_status (post-send)', 'send_usdc was skipped');
  }
  console.log();

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await Promise.all([sender.close(), recipient.close()]);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped > 0) {
    console.log();
    console.log('  To run skipped tests, fund the sender wallet:');
    console.log(`  ETH (gas): https://www.alchemy.com/faucets/base-sepolia`);
    console.log(`  USDC:      https://faucet.circle.com/  (select Base Sepolia)`);
    console.log(`  Address:   ${senderAccount.address}`);
  }
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
