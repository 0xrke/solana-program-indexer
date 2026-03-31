# Solana Program Indexer

A service that indexes Solana program transactions, decodes instructions using Anchor IDL, stores them in PostgreSQL, and exposes a REST API for querying.

## Architecture

```
Solana RPC                PostgreSQL              REST Client
    |                         |                       |
    v                         v                       v
+-----------+          +------------+          +------------+
|  Fetcher  |--------->|  Database  |<---------|   Fastify  |
| (web3.js) |          | (Prisma)   |          |    API     |
+-----------+          +------------+          +------------+
    |                         ^
    v                         |
+-----------+                 |
|  Decoder  |-----------------+
| (Anchor)  |
+-----------+
```

**Data flow:** Fetcher streams transactions from Solana RPC via `getSignaturesForAddress` + `getTransaction`. Decoder uses `BorshInstructionCoder` with the program's Anchor IDL to decode instruction data and account mappings. Decoded transactions and instructions are persisted to PostgreSQL. The REST API reads from the database.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your RPC_URL, PROGRAM_ID, and IDL_PATH
docker-compose up
```

The API will be available at `http://localhost:3000`.

## API Reference

### GET /transactions/:signature

Returns a single transaction with decoded instructions.

```bash
curl http://localhost:3000/transactions/5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQN
```

**Response (200):**
```json
{
  "signature": "5VERv8...",
  "slot": 250000000,
  "blockTime": "2024-01-15T10:30:00.000Z",
  "fee": 5000,
  "success": true,
  "signers": ["pubkey1..."],
  "instructions": [
    {
      "name": "deposit",
      "accounts": [{ "name": "user", "pubkey": "pubkey1..." }],
      "args": { "amount": "0f4240" }
    }
  ]
}
```

**Response (404):** `{ "error": "Transaction not found" }`

### GET /transactions

List transactions with optional filters and pagination.

```bash
# All transactions
curl http://localhost:3000/transactions

# Filter by instruction name
curl http://localhost:3000/transactions?instruction=deposit

# Filter by signer
curl http://localhost:3000/transactions?signer=pubkey1...

# Pagination
curl "http://localhost:3000/transactions?limit=10&offset=20"
```

**Query Parameters:**

| Param | Description | Default |
|-------|------------|---------|
| `instruction` | Filter by instruction name | - |
| `signer` | Filter by signer pubkey | - |
| `limit` | Results per page (1-100) | 20 |
| `offset` | Skip N results | 0 |

**Response (200):**
```json
{
  "data": [{ "signature": "...", "slot": 250000000, ... }],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

## Configuration

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RPC_URL` | Yes | Solana RPC endpoint URL | - |
| `PROGRAM_ID` | Yes | Program address to index | - |
| `IDL_PATH` | One of IDL_PATH/IDL_ADDRESS | Path to local IDL JSON file | - |
| `IDL_ADDRESS` | One of IDL_PATH/IDL_ADDRESS | On-chain IDL address | - |
| `DATABASE_URL` | Yes | PostgreSQL connection string | - |
| `BATCH_SIZE` | No | Signatures per RPC batch | 100 |
| `START_SIGNATURE` | No | Start indexing from this signature | - |
| `END_SIGNATURE` | No | Stop indexing at this signature | - |
| `START_SLOT` | No | Start slot (reserved) | - |
| `END_SLOT` | No | End slot (reserved) | - |

## Development

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for PostgreSQL)

### Local Setup

```bash
# Install dependencies
pnpm install

# Start the test database
docker compose -f docker-compose.test.yml up -d

# Run migrations
DATABASE_URL=postgresql://test:test@localhost:5433/indexer_test pnpm exec prisma migrate dev

# Build
pnpm run build

# Run (with env vars)
DATABASE_URL=postgresql://test:test@localhost:5433/indexer_test \
RPC_URL=https://api.mainnet-beta.solana.com \
PROGRAM_ID=<your-program-id> \
IDL_PATH=./idl/example.json \
pnpm start
```

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript |
| `pnpm run test` | Run unit tests |
| `pnpm run test:integration` | Run integration tests |
| `pnpm run test:coverage` | Run tests with coverage |
| `pnpm run check` | Lint + format (Biome) |
| `pnpm run lint` | Lint only |
| `pnpm run format` | Format only |

### Running Tests

```bash
# Unit tests (no DB needed)
pnpm run test

# Integration tests (needs test DB running)
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgresql://test:test@localhost:5433/indexer_test pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://test:test@localhost:5433/indexer_test pnpm run test:integration
docker compose -f docker-compose.test.yml down
```
