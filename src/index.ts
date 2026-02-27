#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BaseChainProvider } from './chains/base.js';
import { SolanaChainProvider } from './chains/solana.js';
import type { ChainId, ChainConfig, ChainProvider } from './chains/types.js';
import { createServer } from './server.js';

function env(key: string): string | undefined {
  return process.env[key];
}

function buildProviders(): Map<ChainId, ChainProvider> {
  const network = (env('PAYMENT_NETWORK') || 'mainnet') as 'mainnet' | 'testnet';
  const providers = new Map<ChainId, ChainProvider>();

  const baseConfig: ChainConfig = {
    network,
    rpcUrl: env('PAYMENT_RPC_URL_BASE'),
    privateKey: env('PAYMENT_PRIVATE_KEY_BASE'),
  };

  const solanaConfig: ChainConfig = {
    network,
    rpcUrl: env('PAYMENT_RPC_URL_SOLANA'),
    privateKey: env('PAYMENT_PRIVATE_KEY_SOLANA'),
  };

  // Always initialize both providers — they work read-only without a private key
  providers.set('base', new BaseChainProvider(baseConfig));
  providers.set('solana', new SolanaChainProvider(solanaConfig));

  return providers;
}

async function main() {
  const providers = buildProviders();
  const defaultChain = (env('PAYMENT_DEFAULT_CHAIN') || 'base') as ChainId;

  if (!providers.has(defaultChain)) {
    console.error(`Default chain "${defaultChain}" is not available.`);
    process.exit(1);
  }

  const server = createServer(providers, defaultChain);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error starting paean-pay-mcp:', err);
  process.exit(1);
});
