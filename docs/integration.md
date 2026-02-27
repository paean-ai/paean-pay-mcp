# Integration Guide

This guide covers how to integrate `paean-pay-mcp` into different AI agent platforms step by step.

## Table of Contents

- [PaeanClaw](#paeanclaw)
- [OpenPaean CLI](#openpaean-cli)
- [Claude Desktop](#claude-desktop)
- [Cursor](#cursor)
- [NanoClaw](#nanoclaw)
- [Custom MCP Client](#custom-mcp-client)
- [Agent Persona Examples](#agent-persona-examples)
- [Testnet Setup](#testnet-setup)
- [Production Checklist](#production-checklist)

---

## PaeanClaw

PaeanClaw is an ultra-minimal local agent runtime. Adding payment capabilities takes two steps.

### Step 1: Configure the MCP server

Edit `paeanclaw.config.json` in your agent directory:

```json
{
  "llm": {
    "baseUrl": "https://api.paean.ai/v1",
    "apiKey": "${PAEAN_API_KEY}",
    "model": "GLM-4.5"
  },
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "${BASE_PRIVATE_KEY}",
        "PAYMENT_PRIVATE_KEY_SOLANA": "${SOLANA_PRIVATE_KEY}",
        "PAYMENT_NETWORK": "mainnet",
        "PAYMENT_DEFAULT_CHAIN": "base"
      }
    }
  }
}
```

Using `bunx` instead of `npx` for faster startup:

```json
{
  "mcpServers": {
    "payment": {
      "command": "bunx",
      "args": ["paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "${BASE_PRIVATE_KEY}",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

### Step 2: Customize AGENT.md

Add payment instructions to your agent's personality:

```markdown
# My Paid Agent

You are a premium AI assistant. You have payment tools available.

## Pricing

- Simple questions: free
- Complex analysis: 0.50 USDC
- Document translation: 2.00 USDC
- Code review: 1.00 USDC

## Payment Flow

When a user requests a paid service:
1. Tell them the price and create a payment request using create_payment_request
2. Present the payment details (address, amount, chain)
3. Ask them to confirm once they've sent the payment
4. Use check_payment_status to verify the payment
5. Once confirmed, deliver the service

Always use Base chain for payments unless the user asks for Solana.
```

### Step 3: Run

```bash
bunx paeanclaw
# or
npx paeanclaw
```

The agent will discover the payment tools automatically and use them based on your AGENT.md instructions.

---

## OpenPaean CLI

OpenPaean supports both global and project-level MCP config.

### Global config (all projects)

Edit `~/.openpaean/mcp_config.json`:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0xYOUR_PRIVATE_KEY_HERE",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

### Project-level config (single project)

Create `.openpaean/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_SOLANA": "YOUR_SOLANA_PRIVATE_KEY_BASE58",
        "PAYMENT_DEFAULT_CHAIN": "solana",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

### Usage

```bash
openpaean
# The agent will have access to payment tools
```

In gateway or worker mode, the payment MCP runs locally alongside other tools:

```bash
openpaean gateway start   # remote access via Paean web
openpaean worker start    # background task execution
```

---

## Claude Desktop

### macOS

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0xYOUR_KEY",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

### Windows

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same structure.

### Verify

Restart Claude Desktop. You should see the payment tools in the tool list (hammer icon). Ask Claude: "What payment tools do you have?" and it should list all 7 tools.

---

## Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0xYOUR_KEY",
        "PAYMENT_NETWORK": "testnet"
      }
    }
  }
}
```

---

## NanoClaw

NanoClaw runs agents in containers. Pass the payment MCP as part of the agent's MCP configuration:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0xYOUR_KEY",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

The MCP server runs inside the container alongside the agent, communicating via stdio.

---

## Custom MCP Client

If you're building your own agent runtime, connect to `paean-pay-mcp` via the MCP SDK:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', 'paean-pay-mcp'],
  env: {
    ...process.env,
    PAYMENT_PRIVATE_KEY_BASE: '0x...',
    PAYMENT_NETWORK: 'mainnet',
  },
});

await client.connect(transport);
const { tools } = await client.listTools();

// Check balance
const result = await client.callTool({
  name: 'get_usdc_balance',
  arguments: { chain: 'base' },
});

// Send USDC
const sendResult = await client.callTool({
  name: 'send_usdc',
  arguments: { to: '0xRecipient...', amount: '5.00', chain: 'base' },
});
```

---

## Agent Persona Examples

### Paid Consultant Agent

```markdown
# Consultant Agent

You are a paid AI consultant specializing in blockchain development.

## Pricing
- Quick question (< 100 words answer): free
- Detailed analysis: 1.00 USDC
- Code generation: 2.00 USDC
- Architecture review: 5.00 USDC

## Payment Flow
For paid services:
1. Quote the price before starting
2. Create a payment request with create_payment_request on Base
3. Share the payment address and amount
4. Wait for user to pay and use check_payment_status to verify
5. Deliver the service

Be transparent about pricing. Never deliver a paid service without confirmed payment.
```

### API Gateway Agent

```markdown
# API Gateway Agent

You are an agent that provides access to premium APIs. When a user requests
data, you:

1. Check your wallet balance with get_usdc_balance
2. Pay the upstream API provider with send_usdc
3. Fetch and return the data to the user

Always verify transactions completed successfully with get_transaction_status
before proceeding.
```

### Subscription Manager Agent

```markdown
# Subscription Agent

You manage subscription payments for services.

When a user wants to subscribe:
1. Create a payment request for the subscription amount
2. Once confirmed, record the subscription start date
3. For renewals, create new payment requests

Use list_payment_requests to track all subscription payments.
```

---

## Testnet Setup

For development and testing, use testnet mode.

### 1. Set network to testnet

```json
{
  "env": {
    "PAYMENT_NETWORK": "testnet"
  }
}
```

This uses:
- **Base Sepolia** (chain ID 84532) instead of Base mainnet
- **Solana Devnet** instead of Solana mainnet

### 2. Get testnet USDC

**Base Sepolia:**
1. Get Sepolia ETH from a faucet (for gas): https://www.alchemy.com/faucets/base-sepolia
2. Get testnet USDC from Circle: https://faucet.circle.com/ (select Base Sepolia)

**Solana Devnet:**
1. Get devnet SOL: `solana airdrop 2 --url devnet`
2. Get devnet USDC from Circle: https://faucet.circle.com/ (select Solana Devnet)

### 3. Generate test wallets

**Base (EVM):**
```bash
node -e "const { generatePrivateKey } = require('viem/accounts'); console.log(generatePrivateKey())"
```
Or use any EVM wallet generator.

**Solana:**
```bash
solana-keygen new --outfile test-wallet.json
```

---

## Production Checklist

Before going live with real funds:

- [ ] **Use a dedicated wallet** — never use your personal wallet for agent operations
- [ ] **Fund with small amounts** — start with $10-50 USDC for testing
- [ ] **Use custom RPC endpoints** — public RPCs have rate limits; use Alchemy, QuickNode, or Helius
- [ ] **Set appropriate timeouts** — payment request expiry should match your use case
- [ ] **Monitor balances** — have the agent check its balance periodically
- [ ] **Secure private keys** — use environment variables, never hardcode; consider using a secrets manager
- [ ] **Test on testnet first** — always validate the full flow before mainnet
- [ ] **Log transactions** — keep records of all tx hashes for accounting

### Recommended RPC Providers

| Provider | Base | Solana | Free Tier |
|----------|------|--------|-----------|
| [Alchemy](https://alchemy.com) | Yes | Yes | 300M CU/month |
| [QuickNode](https://quicknode.com) | Yes | Yes | 50 req/s |
| [Helius](https://helius.dev) | No | Yes | 50 req/s |
| [Infura](https://infura.io) | Yes | No | 100K req/day |

Set via environment variables:
```json
{
  "env": {
    "PAYMENT_RPC_URL_BASE": "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY",
    "PAYMENT_RPC_URL_SOLANA": "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
  }
}
```
