import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ChainProvider, ChainId } from './chains/types.js';
import { paymentStore } from './store.js';

const CHAIN_ENUM = z.enum(['base', 'solana']);

export function createServer(
  providers: Map<ChainId, ChainProvider>,
  defaultChain: ChainId,
): McpServer {
  const server = new McpServer({
    name: 'paean-pay-mcp',
    version: '0.1.0',
  });

  function getProvider(chain?: ChainId): ChainProvider {
    const c = chain || defaultChain;
    const p = providers.get(c);
    if (!p) throw new Error(`Chain "${c}" is not configured.`);
    return p;
  }

  // ── Tool 1: get_wallet_address ────────────────────────────────────────

  server.tool(
    'get_wallet_address',
    'Get the configured wallet address for receiving or sending USDC. Returns addresses for all configured chains if no chain is specified.',
    { chain: CHAIN_ENUM.optional().describe('Chain to get address for. Omit for all configured chains.') },
    async (args) => {
      if (args.chain) {
        const provider = getProvider(args.chain);
        const address = provider.getWalletAddress();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            chain: args.chain,
            address: address || 'Not configured (no private key set)',
          }, null, 2) }],
        };
      }

      const wallets: Record<string, string> = {};
      for (const [chain, provider] of providers) {
        wallets[chain] = provider.getWalletAddress() || 'Not configured';
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(wallets, null, 2) }],
      };
    },
  );

  // ── Tool 2: get_usdc_balance ──────────────────────────────────────────

  server.tool(
    'get_usdc_balance',
    'Check the USDC balance for any wallet address on Base or Solana.',
    {
      address: z.string().describe('Wallet address to check balance for. If omitted, checks the configured wallet.').optional(),
      chain: CHAIN_ENUM.optional().describe('Chain to check. Defaults to the configured default chain.'),
    },
    async (args) => {
      const provider = getProvider(args.chain);
      const address = args.address || provider.getWalletAddress();
      if (!address) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No address provided and no wallet configured for this chain.' }],
          isError: true,
        };
      }
      try {
        const result = await provider.getBalance(address);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error checking balance: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 3: create_payment_request ────────────────────────────────────

  server.tool(
    'create_payment_request',
    'Create a payment request for receiving USDC. Returns a unique payment ID, the recipient address, amount, and memo that the payer should include. The agent can present this information to a user or another agent to collect payment.',
    {
      amount: z.string().describe('USDC amount to request, e.g. "5.00"'),
      chain: CHAIN_ENUM.optional().describe('Chain to receive payment on. Defaults to the configured default chain.'),
      memo: z.string().optional().describe('Optional memo/note for the payment'),
      expires_in_minutes: z.number().optional().describe('Expiry time in minutes (default: 30)'),
    },
    async (args) => {
      const parsedAmount = parseFloat(args.amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Amount must be a positive number, e.g. "5.00".' }],
          isError: true,
        };
      }
      if (parsedAmount > 1_000_000) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Amount exceeds the maximum allowed limit of 1,000,000 USDC per request.' }],
          isError: true,
        };
      }

      const provider = getProvider(args.chain);
      const address = provider.getWalletAddress();
      if (!address) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No wallet configured for this chain. Set the private key to create payment requests.' }],
          isError: true,
        };
      }

      const chain = args.chain || defaultChain;
      const request = paymentStore.create({
        chain,
        recipientAddress: address,
        amount: args.amount,
        memo: args.memo,
        expiresInMinutes: args.expires_in_minutes,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          payment_id: request.id,
          status: request.status,
          chain,
          recipient_address: address,
          amount_usdc: request.amount,
          memo: request.memo,
          expires_at: new Date(request.expiresAt).toISOString(),
          instructions: `Send ${request.amount} USDC to ${address} on ${chain}. Include memo: ${request.memo}`,
        }, null, 2) }],
      };
    },
  );

  // ── Tool 4: check_payment_status ──────────────────────────────────────

  server.tool(
    'check_payment_status',
    'Check whether a payment request has been fulfilled by looking for matching on-chain transfers. Updates the payment request status if a matching transfer is found.',
    {
      payment_id: z.string().describe('The payment request ID to check'),
    },
    async (args) => {
      const request = paymentStore.get(args.payment_id);
      if (!request) {
        return {
          content: [{ type: 'text' as const, text: `Error: Payment request "${args.payment_id}" not found.` }],
          isError: true,
        };
      }

      if (request.status === 'confirmed') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            payment_id: request.id,
            status: 'confirmed',
            confirmed_tx: request.confirmedTxHash,
            confirmed_at: request.confirmedAt ? new Date(request.confirmedAt).toISOString() : null,
          }, null, 2) }],
        };
      }

      if (request.status === 'expired') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            payment_id: request.id,
            status: 'expired',
            expired_at: new Date(request.expiresAt).toISOString(),
          }, null, 2) }],
        };
      }

      // Check on-chain for inbound transfers since the request was created
      try {
        const provider = getProvider(request.chain);
        const sinceTimestamp = Math.floor(request.createdAt / 1000);
        const transfers = await provider.getRecentInboundTransfers(
          request.recipientAddress,
          sinceTimestamp,
        );

        const expectedAmount = parseFloat(request.amount);
        const match = transfers.find(t => {
          const received = parseFloat(t.amount);
          return received >= expectedAmount * 0.99; // 1% tolerance for rounding
        });

        if (match) {
          paymentStore.confirm(request.id, match.txHash);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              payment_id: request.id,
              status: 'confirmed',
              confirmed_tx: match.txHash,
              from: match.from,
              amount_received: match.amount,
            }, null, 2) }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            payment_id: request.id,
            status: 'pending',
            amount_expected: request.amount,
            chain: request.chain,
            recipient_address: request.recipientAddress,
            expires_at: new Date(request.expiresAt).toISOString(),
            recent_transfers_checked: transfers.length,
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error checking payment: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 5: send_usdc ─────────────────────────────────────────────────

  server.tool(
    'send_usdc',
    'Send USDC to a target address. Requires a private key to be configured for the specified chain. Use this to pay for services or send funds to another agent or user.',
    {
      to: z.string().describe('Recipient wallet address'),
      amount: z.string().describe('USDC amount to send, e.g. "10.00"'),
      chain: CHAIN_ENUM.optional().describe('Chain to send on. Defaults to the configured default chain.'),
    },
    async (args) => {
      const parsedAmount = parseFloat(args.amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Amount must be a positive number, e.g. "10.00".' }],
          isError: true,
        };
      }
      if (parsedAmount > 1_000_000) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Amount exceeds the maximum allowed limit of 1,000,000 USDC per transfer.' }],
          isError: true,
        };
      }
      if (!args.to || args.to.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Recipient address is required.' }],
          isError: true,
        };
      }

      const provider = getProvider(args.chain);
      try {
        const result = await provider.sendUsdc(args.to.trim(), args.amount);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            success: true,
            tx_hash: result.txHash,
            chain: result.chain,
            from: result.from,
            to: result.to,
            amount_usdc: result.amount,
            explorer_url: result.explorerUrl,
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error sending USDC: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 6: get_transaction_status ────────────────────────────────────

  server.tool(
    'get_transaction_status',
    'Look up a transaction by its hash and return its confirmation status, block number, timestamp, and transfer details.',
    {
      tx_hash: z.string().describe('Transaction hash to look up'),
      chain: CHAIN_ENUM.optional().describe('Chain the transaction is on. Defaults to the configured default chain.'),
    },
    async (args) => {
      const provider = getProvider(args.chain);
      try {
        const status = await provider.getTransactionStatus(args.tx_hash);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error looking up transaction: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 7: list_payment_requests ─────────────────────────────────────

  server.tool(
    'list_payment_requests',
    'List all tracked payment requests and their statuses. Can filter by status or chain.',
    {
      status: z.enum(['pending', 'confirmed', 'expired']).optional().describe('Filter by payment status'),
      chain: CHAIN_ENUM.optional().describe('Filter by chain'),
    },
    async (args) => {
      const requests = paymentStore.list({
        status: args.status,
        chain: args.chain,
      });

      const summary = requests.map(r => ({
        id: r.id,
        status: r.status,
        chain: r.chain,
        amount: r.amount,
        memo: r.memo,
        created_at: new Date(r.createdAt).toISOString(),
        expires_at: new Date(r.expiresAt).toISOString(),
        confirmed_tx: r.confirmedTxHash || null,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          total: summary.length,
          requests: summary,
        }, null, 2) }],
      };
    },
  );

  return server;
}
