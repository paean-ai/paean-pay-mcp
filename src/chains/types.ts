export type ChainId = 'base' | 'solana';
export type NetworkId = 'mainnet' | 'testnet';

export interface TransferResult {
  txHash: string;
  chain: ChainId;
  from: string;
  to: string;
  /** Human-readable amount, e.g. "1.50" */
  amount: string;
  explorerUrl: string;
}

export interface BalanceResult {
  address: string;
  chain: ChainId;
  /** Human-readable balance, e.g. "42.00" */
  balance: string;
  /** Raw integer amount in smallest unit (6 decimals) */
  rawBalance: string;
}

export interface TransactionStatus {
  txHash: string;
  chain: ChainId;
  confirmed: boolean;
  blockNumber?: number;
  timestamp?: number;
  from?: string;
  to?: string;
  amount?: string;
  explorerUrl: string;
}

export interface RecentTransfer {
  txHash: string;
  from: string;
  amount: string;
  timestamp: number;
}

/**
 * Abstraction over a blockchain for USDC operations.
 * Each chain (Base, Solana) implements this interface.
 */
export interface ChainProvider {
  readonly chain: ChainId;

  /** Wallet address derived from the configured private key, or null if no key set */
  getWalletAddress(): string | null;

  /** USDC balance for any address */
  getBalance(address: string): Promise<BalanceResult>;

  /** Send USDC (requires private key). Amount is human-readable, e.g. "1.50" */
  sendUsdc(to: string, amount: string): Promise<TransferResult>;

  /** Transaction status by hash */
  getTransactionStatus(txHash: string): Promise<TransactionStatus>;

  /** Recent inbound USDC transfers to the given address (best-effort, last N minutes) */
  getRecentInboundTransfers(address: string, sinceTimestamp: number): Promise<RecentTransfer[]>;
}

export const USDC_DECIMALS = 6;

/** Convert human amount like "1.50" to on-chain integer (bigint for EVM, number for Solana) */
export function parseUsdcAmount(amount: string): bigint {
  const parts = amount.split('.');
  const whole = parts[0] || '0';
  let frac = (parts[1] || '').slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0');
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
}

/** Convert on-chain integer to human-readable string */
export function formatUsdcAmount(raw: bigint | number | string): string {
  const n = BigInt(raw);
  const whole = n / BigInt(10 ** USDC_DECIMALS);
  const frac = n % BigInt(10 ** USDC_DECIMALS);
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '0';
  return `${whole}.${fracStr}`;
}

export interface ChainConfig {
  network: NetworkId;
  rpcUrl?: string;
  /** Hex private key (Base: 0x…, Solana: base58). Takes precedence over mnemonic. */
  privateKey?: string;
  /** BIP-39 mnemonic phrase (12 or 24 words). Used when privateKey is not set. */
  mnemonic?: string;
  /** HD derivation path. Default: m/44'/60'/0'/0/0 (Base) or m/44'/501'/0'/0' (Solana). */
  hdPath?: string;
}
