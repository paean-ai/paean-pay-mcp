# paean-pay-mcp

Stablecoin payment MCP server — USDC on **Base** & **Solana** for AI agents.

[![npm version](https://img.shields.io/npm/v/paean-pay-mcp.svg)](https://www.npmjs.com/package/paean-pay-mcp) [![license](https://img.shields.io/npm/l/paean-pay-mcp.svg)](LICENSE)

Give your AI agent economic sovereignty: accept payments for services, pay for external APIs, and transact with other agents — all through standard MCP tool calls.

## Quick Start

No install needed — run directly with `npx` or `bunx`:

```bash
npx paean-pay-mcp
# or
bunx paean-pay-mcp
```

The server communicates via **stdio** and is compatible with any MCP client: PaeanClaw, OpenPaean CLI, Claude Desktop, Cursor, and more.

## Why This Exists

AI agents need to transact. Whether your agent charges users for a service, pays for external API calls, or settles with other agents, it needs a payment rail that is:

- **Fast** — sub-second (Solana) to 2-second (Base) finality
- **Cheap** — fractions of a cent per transaction
- **Programmable** — no bank APIs, no KYC for agent-to-agent transfers
- **Stablecoin-native** — USDC avoids crypto volatility

This MCP server wraps both chains behind a clean set of 7 tools that any LLM agent can call.

## Supported Chains

| Chain | Token | Tx Cost | Finality | Best For |
|-------|-------|---------|----------|----------|
| **Base** (Coinbase L2) | USDC | < $0.01 | ~2s | General payments, EVM ecosystem |
| **Solana** | USDC | < $0.001 | ~400ms | High-frequency micro-payments |

## Configuration

All configuration is via environment variables, passed through your MCP client config:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PAYMENT_PRIVATE_KEY_BASE` | For sending | — | Hex private key for Base wallet |
| `PAYMENT_PRIVATE_KEY_SOLANA` | For sending | — | Base58 private key for Solana wallet |
| `PAYMENT_RPC_URL_BASE` | No | `https://mainnet.base.org` | Custom Base RPC endpoint |
| `PAYMENT_RPC_URL_SOLANA` | No | `https://api.mainnet-beta.solana.com` | Custom Solana RPC endpoint |
| `PAYMENT_NETWORK` | No | `mainnet` | `mainnet` or `testnet` |
| `PAYMENT_DEFAULT_CHAIN` | No | `base` | Default chain: `base` or `solana` |

**Read-only mode**: Without private keys, the server still works for balance checks, transaction lookups, and payment request tracking. Private keys are only needed for `send_usdc` and `create_payment_request`.

**Testnet mode**: Set `PAYMENT_NETWORK=testnet` to use Base Sepolia and Solana Devnet. Get test USDC from [Circle's faucet](https://faucet.circle.com/).

## Tools

### `get_wallet_address`

Returns the configured wallet address(es) for the agent.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | `"base"` \| `"solana"` | No | Specific chain. Omit for all chains. |

**Output:** Wallet address(es) for the configured chains.

---

### `get_usdc_balance`

Check the USDC balance for any wallet address.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | No | Address to check. Defaults to the agent's own wallet. |
| `chain` | `"base"` \| `"solana"` | No | Chain to check. Defaults to `PAYMENT_DEFAULT_CHAIN`. |

**Output:** Balance in human-readable format (e.g. `"42.50"`) plus raw integer.

---

### `create_payment_request`

Create a payment request with a unique ID. The agent presents the payment details to the payer, then uses `check_payment_status` to verify receipt.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | string | **Yes** | USDC amount, e.g. `"5.00"` |
| `chain` | `"base"` \| `"solana"` | No | Chain to receive on |
| `memo` | string | No | Note for the payment |
| `expires_in_minutes` | number | No | Expiry (default: 30 minutes) |

**Output:** Payment ID, recipient address, amount, memo, expiry, and human-readable instructions.

---

### `check_payment_status`

Poll the blockchain to check if a payment request has been fulfilled.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payment_id` | string | **Yes** | The payment request ID |

**Output:** Status (`pending`, `confirmed`, or `expired`), and transaction details if confirmed.

---

### `send_usdc`

Execute a USDC transfer to a target address. Requires a private key.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | **Yes** | Recipient address |
| `amount` | string | **Yes** | USDC amount, e.g. `"10.00"` |
| `chain` | `"base"` \| `"solana"` | No | Chain to send on |

**Output:** Transaction hash, explorer URL, and transfer details.

---

### `get_transaction_status`

Look up any transaction by hash.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tx_hash` | string | **Yes** | Transaction hash |
| `chain` | `"base"` \| `"solana"` | No | Chain the tx is on |

**Output:** Confirmation status, block number, timestamp, from/to/amount if available.

---

### `list_payment_requests`

List all tracked payment requests from this session.

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `"pending"` \| `"confirmed"` \| `"expired"` | No | Filter by status |
| `chain` | `"base"` \| `"solana"` | No | Filter by chain |

**Output:** Array of payment requests with their current status.

## Integration

### PaeanClaw

Add to your `paeanclaw.config.json`:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "${BASE_PRIVATE_KEY}",
        "PAYMENT_PRIVATE_KEY_SOLANA": "${SOLANA_PRIVATE_KEY}",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

Then customize your `AGENT.md` to instruct the agent on when to charge:

```markdown
## Payment Policy

You are a paid assistant. Before answering premium questions, create a payment
request for $0.10 USDC on Base. Wait for the user to pay, verify the payment
using check_payment_status, then proceed with the answer.
```

### OpenPaean CLI

Add to `~/.openpaean/mcp_config.json` (global) or `.openpaean/mcp.json` (project):

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0x...",
        "PAYMENT_NETWORK": "mainnet"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0x...",
        "PAYMENT_NETWORK": "testnet"
      }
    }
  }
}
```

### Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "payment": {
      "command": "npx",
      "args": ["-y", "paean-pay-mcp"],
      "env": {
        "PAYMENT_PRIVATE_KEY_BASE": "0x..."
      }
    }
  }
}
```

### Any MCP Client

The server uses stdio transport. Configure it the same way you would any other MCP server:

```
command: npx
args: ["-y", "paean-pay-mcp"]
env: { PAYMENT_PRIVATE_KEY_BASE: "0x...", PAYMENT_NETWORK: "mainnet" }
```

## Example Workflows

### Agent Charges for a Service

```
User: "Translate this document to Japanese"
Agent: → create_payment_request(amount: "2.00", chain: "base", memo: "translation-service")
Agent: "Please send 2.00 USDC to 0xABC...123 on Base. Payment ID: a1b2c3d4"
User: *sends payment*
Agent: → check_payment_status(payment_id: "a1b2c3d4")
Agent: "Payment confirmed! Here's your translation: ..."
```

### Agent Pays for an External API

```
User: "Get me the latest market analysis"
Agent: → send_usdc(to: "0xDEF...789", amount: "0.50", chain: "base")
Agent: "Paid 0.50 USDC for premium market data. Here's the analysis: ..."
```

### Agent-to-Agent Payment

```
Agent A: → send_usdc(to: "SOLANA_ADDRESS", amount: "1.00", chain: "solana")
Agent B: → check_payment_status(payment_id: "...")
Agent B: "Payment received. Processing your request..."
```

## Security

- **Private keys** are passed via environment variables and never logged or exposed through tool outputs
- **Read-only by default** — without private keys, no funds can be sent
- **In-memory store** — payment request tracking is ephemeral; restarting clears all state
- Use **testnet** (`PAYMENT_NETWORK=testnet`) for development and testing

## USDC Contract Addresses

| Network | Chain | Address |
|---------|-------|---------|
| Mainnet | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Mainnet | Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Testnet | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Testnet | Solana Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## Development

```bash
git clone https://github.com/paean-ai/paean-pay-mcp.git
cd paean-pay-mcp
npm install
npm run build
PAYMENT_NETWORK=testnet node dist/index.js
```

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Requirements

- Node.js 20+ or Bun 1.0+

## License

MIT
