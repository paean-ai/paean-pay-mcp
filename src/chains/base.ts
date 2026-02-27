import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type PublicClient,
  type Chain,
  type HttpTransport,
} from 'viem';
import { type PrivateKeyAccount } from 'viem/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
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

const USDC_ADDRESSES = {
  mainnet: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  testnet: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
};

const EXPLORER_URLS = {
  mainnet: 'https://basescan.org',
  testnet: 'https://sepolia.basescan.org',
};

const DEFAULT_RPC = {
  mainnet: 'https://mainnet.base.org',
  testnet: 'https://sepolia.base.org',
};

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export class BaseChainProvider implements ChainProvider {
  readonly chain = 'base' as const;
  private publicClient: PublicClient<HttpTransport, Chain>;
  private walletAccount: PrivateKeyAccount | null = null;
  private viemChain: Chain;
  private walletAddress: string | null = null;
  private usdcAddress: `0x${string}`;
  private explorerUrl: string;
  private network: 'mainnet' | 'testnet';

  private rpcUrl: string;

  constructor(config: ChainConfig) {
    this.network = config.network;
    this.viemChain = config.network === 'mainnet' ? base : baseSepolia;
    this.rpcUrl = config.rpcUrl || DEFAULT_RPC[config.network];
    this.usdcAddress = USDC_ADDRESSES[config.network];
    this.explorerUrl = EXPLORER_URLS[config.network];

    this.publicClient = createPublicClient({
      chain: this.viemChain,
      transport: http(this.rpcUrl),
    }) as PublicClient<HttpTransport, Chain>;

    if (config.privateKey) {
      const key = config.privateKey.startsWith('0x')
        ? config.privateKey as `0x${string}`
        : `0x${config.privateKey}` as `0x${string}`;
      this.walletAccount = privateKeyToAccount(key);
      this.walletAddress = this.walletAccount.address;
    }
  }

  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const raw = await this.publicClient.readContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return {
      address,
      chain: 'base',
      balance: formatUsdcAmount(raw),
      rawBalance: raw.toString(),
    };
  }

  async sendUsdc(to: string, amount: string): Promise<TransferResult> {
    if (!this.walletAccount || !this.walletAddress) {
      throw new Error('No private key configured for Base chain. Set PAYMENT_PRIVATE_KEY_BASE to send USDC.');
    }
    const walletClient = createWalletClient({
      account: this.walletAccount,
      chain: this.viemChain,
      transport: http(this.rpcUrl),
    });
    const rawAmount = parseUsdcAmount(amount);
    const hash = await walletClient.writeContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to as `0x${string}`, rawAmount],
    });
    return {
      txHash: hash,
      chain: 'base',
      from: this.walletAddress,
      to,
      amount,
      explorerUrl: `${this.explorerUrl}/tx/${hash}`,
    };
  }

  async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    }).catch(() => null);

    if (!receipt) {
      return {
        txHash,
        chain: 'base',
        confirmed: false,
        explorerUrl: `${this.explorerUrl}/tx/${txHash}`,
      };
    }

    let from: string | undefined;
    let to: string | undefined;
    let amount: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === this.usdcAddress.toLowerCase() && log.topics[0]) {
        try {
          from = `0x${log.topics[1]?.slice(26)}`;
          to = `0x${log.topics[2]?.slice(26)}`;
          amount = formatUsdcAmount(BigInt(log.data));
        } catch {}
      }
    }

    const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });

    return {
      txHash,
      chain: 'base',
      confirmed: receipt.status === 'success',
      blockNumber: Number(receipt.blockNumber),
      timestamp: Number(block.timestamp),
      from,
      to,
      amount,
      explorerUrl: `${this.explorerUrl}/tx/${txHash}`,
    };
  }

  async getRecentInboundTransfers(address: string, sinceTimestamp: number): Promise<RecentTransfer[]> {
    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      // ~2s block time on Base, estimate blocks since timestamp
      const now = Math.floor(Date.now() / 1000);
      const secondsAgo = Math.max(now - sinceTimestamp, 60);
      const blocksBack = BigInt(Math.ceil(secondsAgo / 2));
      const fromBlock = currentBlock > blocksBack ? currentBlock - blocksBack : 0n;

      const logs = await this.publicClient.getLogs({
        address: this.usdcAddress,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { type: 'address', name: 'from', indexed: true },
            { type: 'address', name: 'to', indexed: true },
            { type: 'uint256', name: 'value' },
          ],
        },
        args: { to: address as `0x${string}` },
        fromBlock,
        toBlock: 'latest',
      });

      const results: RecentTransfer[] = [];
      for (const log of logs) {
        const block = await this.publicClient.getBlock({ blockNumber: log.blockNumber! });
        results.push({
          txHash: log.transactionHash!,
          from: log.args.from!,
          amount: formatUsdcAmount(log.args.value!),
          timestamp: Number(block.timestamp),
        });
      }
      return results.filter(t => t.timestamp >= sinceTimestamp);
    } catch {
      return [];
    }
  }
}
