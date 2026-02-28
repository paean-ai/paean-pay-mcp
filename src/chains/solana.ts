import {
  Connection,
  Keypair,
  PublicKey,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { mnemonicToSeedSync } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import {
  type ChainProvider,
  type ChainConfig,
  type BalanceResult,
  type TransferResult,
  type TransactionStatus,
  type RecentTransfer,
  USDC_DECIMALS,
  parseUsdcAmount,
  formatUsdcAmount,
} from './types.js';

const USDC_MINTS = {
  mainnet: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  testnet: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
};

const EXPLORER_URLS = {
  mainnet: 'https://solscan.io',
  testnet: 'https://solscan.io',
};

const DEFAULT_RPC = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  testnet: 'https://api.devnet.solana.com',
};

export class SolanaChainProvider implements ChainProvider {
  readonly chain = 'solana' as const;
  private connection: Connection;
  private keypair: Keypair | null = null;
  private walletAddress: string | null = null;
  private usdcMint: PublicKey;
  private explorerUrl: string;
  private network: 'mainnet' | 'testnet';

  constructor(config: ChainConfig) {
    this.network = config.network;
    const rpcUrl = config.rpcUrl || DEFAULT_RPC[config.network];
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.usdcMint = USDC_MINTS[config.network];
    this.explorerUrl = EXPLORER_URLS[config.network];

    if (config.privateKey) {
      try {
        const decoded = bs58.decode(config.privateKey);
        this.keypair = Keypair.fromSecretKey(decoded);
      } catch {
        const bytes = Uint8Array.from(
          config.privateKey.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []
        );
        this.keypair = Keypair.fromSecretKey(bytes);
      }
    } else if (config.mnemonic) {
      const seed = mnemonicToSeedSync(config.mnemonic);
      const path = config.hdPath ?? "m/44'/501'/0'/0'";
      const derived = derivePath(path, Buffer.from(seed).toString('hex'));
      this.keypair = Keypair.fromSeed(derived.key);
    }

    if (this.keypair) {
      this.walletAddress = this.keypair.publicKey.toBase58();
    }
  }

  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const owner = new PublicKey(address);
    try {
      const ata = getAssociatedTokenAddressSync(this.usdcMint, owner, true);
      const info = await this.connection.getTokenAccountBalance(ata);
      return {
        address,
        chain: 'solana',
        balance: info.value.uiAmountString || '0',
        rawBalance: info.value.amount,
      };
    } catch {
      return {
        address,
        chain: 'solana',
        balance: '0',
        rawBalance: '0',
      };
    }
  }

  async sendUsdc(to: string, amount: string): Promise<TransferResult> {
    if (!this.keypair) {
      throw new Error('No wallet configured for Solana chain. Set PAYMENT_PRIVATE_KEY_SOLANA or PAYMENT_MNEMONIC to send USDC.');
    }

    const rawAmount = parseUsdcAmount(amount);
    const destination = new PublicKey(to);

    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      this.usdcMint,
      this.keypair.publicKey,
    );

    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      this.usdcMint,
      destination,
    );

    const sig = await transfer(
      this.connection,
      this.keypair,
      sourceAta.address,
      destAta.address,
      this.keypair,
      rawAmount,
    );

    const clusterParam = this.network === 'testnet' ? '?cluster=devnet' : '';
    return {
      txHash: sig,
      chain: 'solana',
      from: this.keypair.publicKey.toBase58(),
      to,
      amount,
      explorerUrl: `${this.explorerUrl}/tx/${sig}${clusterParam}`,
    };
  }

  async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
    const clusterParam = this.network === 'testnet' ? '?cluster=devnet' : '';

    const tx = await this.connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
    }).catch(() => null);

    if (!tx) {
      return {
        txHash,
        chain: 'solana',
        confirmed: false,
        explorerUrl: `${this.explorerUrl}/tx/${txHash}${clusterParam}`,
      };
    }

    const transfer = this.extractTransferInfo(tx);

    return {
      txHash,
      chain: 'solana',
      confirmed: tx.meta?.err === null,
      blockNumber: tx.slot,
      timestamp: tx.blockTime ?? undefined,
      from: transfer?.from,
      to: transfer?.to,
      amount: transfer?.amount,
      explorerUrl: `${this.explorerUrl}/tx/${txHash}${clusterParam}`,
    };
  }

  async getRecentInboundTransfers(address: string, sinceTimestamp: number): Promise<RecentTransfer[]> {
    try {
      const owner = new PublicKey(address);
      const ata = getAssociatedTokenAddressSync(this.usdcMint, owner, true);

      const sigs = await this.connection.getSignaturesForAddress(ata, { limit: 20 });
      const results: RecentTransfer[] = [];

      for (const sig of sigs) {
        if (sig.blockTime && sig.blockTime < sinceTimestamp) break;

        const tx = await this.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) continue;

        const info = this.extractTransferInfo(tx);
        if (info && info.to === address) {
          results.push({
            txHash: sig.signature,
            from: info.from || 'unknown',
            amount: info.amount || '0',
            timestamp: sig.blockTime || 0,
          });
        }
      }

      return results.filter(t => t.timestamp >= sinceTimestamp);
    } catch {
      return [];
    }
  }

  private extractTransferInfo(tx: ParsedTransactionWithMeta): { from?: string; to?: string; amount?: string } | null {
    if (!tx.meta?.postTokenBalances || !tx.meta?.preTokenBalances) return null;

    const pre = tx.meta.preTokenBalances.filter(
      b => b.mint === this.usdcMint.toBase58()
    );
    const post = tx.meta.postTokenBalances.filter(
      b => b.mint === this.usdcMint.toBase58()
    );

    let from: string | undefined;
    let to: string | undefined;
    let amount: string | undefined;

    for (const p of post) {
      const matching = pre.find(pr => pr.accountIndex === p.accountIndex);
      const preBal = BigInt(matching?.uiTokenAmount.amount || '0');
      const postBal = BigInt(p.uiTokenAmount.amount || '0');
      const diff = postBal - preBal;
      if (diff > 0n) {
        to = p.owner || undefined;
        amount = formatUsdcAmount(diff);
      } else if (diff < 0n) {
        from = p.owner || undefined;
      }
    }

    return { from, to, amount };
  }
}
