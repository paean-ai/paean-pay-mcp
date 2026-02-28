#!/usr/bin/env node
/**
 * Generate test wallets for Base Sepolia and Solana Devnet.
 * Run: node scripts/gen-wallets.mjs
 *
 * WARNING: These are throwaway test wallets. Never use for mainnet.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ── Base Sepolia wallet ──────────────────────────────────────────────────────
const basePrivKey = generatePrivateKey();
const baseAccount = privateKeyToAccount(basePrivKey);

// ── Solana Devnet wallet ─────────────────────────────────────────────────────
const solanaKeypair = Keypair.generate();
const solanaPrivKey = bs58.encode(solanaKeypair.secretKey);
const solanaAddress = solanaKeypair.publicKey.toBase58();

console.log('='.repeat(60));
console.log('  Testnet Wallets Generated (DO NOT USE ON MAINNET)');
console.log('='.repeat(60));
console.log();

console.log('── Base Sepolia ─────────────────────────────────────────────');
console.log(`  Address:     ${baseAccount.address}`);
console.log(`  Private Key: ${basePrivKey}`);
console.log();

console.log('── Solana Devnet ────────────────────────────────────────────');
console.log(`  Address:     ${solanaAddress}`);
console.log(`  Private Key: ${solanaPrivKey}`);
console.log();

console.log('='.repeat(60));
console.log('  Next steps:');
console.log('='.repeat(60));
console.log();
console.log('1. Get Base Sepolia ETH (gas):');
console.log('   https://www.alchemy.com/faucets/base-sepolia');
console.log(`   Address: ${baseAccount.address}`);
console.log();
console.log('2. Get testnet USDC (Base Sepolia + Solana Devnet):');
console.log('   https://faucet.circle.com/');
console.log(`   Base address:   ${baseAccount.address}`);
console.log(`   Solana address: ${solanaAddress}`);
console.log();
console.log('3. Get Solana Devnet SOL (gas):');
console.log(`   solana airdrop 2 ${solanaAddress} --url devnet`);
console.log('   or: https://faucet.solana.com/');
console.log();
console.log('4. Copy these env vars into .env.testnet:');
console.log();
console.log(`PAYMENT_NETWORK=testnet`);
console.log(`PAYMENT_DEFAULT_CHAIN=base`);
console.log(`PAYMENT_PRIVATE_KEY_BASE=${basePrivKey}`);
console.log(`PAYMENT_PRIVATE_KEY_SOLANA=${solanaPrivKey}`);
console.log();
