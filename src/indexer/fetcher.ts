import type {
  Connection,
  PublicKey,
  VersionedBlockResponse,
  VersionedTransactionResponse,
} from '@solana/web3.js';
import pino from 'pino';

const logger = pino({ name: 'fetcher' });

const MAX_RETRIES = 5;
let baseDelayMs = 1000;

export function setBaseDelay(ms: number) {
  baseDelayMs = ms;
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isRateLimit = message.includes('429') || message.includes('Too many requests');
      if (!isRateLimit || attempt === retries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn({ attempt: attempt + 1, delay }, 'Rate limited, retrying...');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export interface FetchBySignatureOptions {
  connection: Connection;
  programId: PublicKey;
  startSignature?: string;
  endSignature?: string;
  batchSize: number;
  maxTransactions?: number;
}

export interface FetchBySlotOptions {
  connection: Connection;
  programId: PublicKey;
  startSlot: number;
  endSlot?: number;
  batchSize: number;
  maxTransactions?: number;
}

export async function* fetchTransactionsBySignature(
  options: FetchBySignatureOptions,
): AsyncGenerator<VersionedTransactionResponse> {
  const { connection, programId, startSignature, endSignature, batchSize, maxTransactions } =
    options;
  let beforeSig: string | undefined = startSignature;
  let count = 0;

  while (true) {
    const signatures = await withRetry(() =>
      connection.getSignaturesForAddress(programId, {
        before: beforeSig,
        until: endSignature,
        limit: batchSize,
      }),
    );

    if (signatures.length === 0) break;

    for (const sigInfo of signatures) {
      if (sigInfo.err) continue;

      const tx = await withRetry(() =>
        connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        }),
      );

      if (tx) {
        yield tx;
        count++;
        if (count % 100 === 0) {
          logger.info({ count, signature: sigInfo.signature }, 'Fetching progress');
        }
        if (maxTransactions && count >= maxTransactions) {
          logger.info({ total: count }, 'Reached max transactions limit');
          return;
        }
      }

      // Small delay between individual getTransaction calls to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs > 1 ? 50 : 0));
    }

    beforeSig = signatures[signatures.length - 1].signature;
  }

  logger.info({ total: count }, 'Fetching complete');
}

export async function* fetchTransactionsBySlot(
  options: FetchBySlotOptions,
): AsyncGenerator<VersionedTransactionResponse> {
  const { connection, programId, startSlot, endSlot, batchSize, maxTransactions } = options;
  const programIdStr = programId.toBase58();
  let currentSlot = startSlot;
  let count = 0;

  const finalSlot = endSlot ?? (await withRetry(() => connection.getSlot()));

  while (currentSlot <= finalSlot) {
    const batchEnd = Math.min(currentSlot + batchSize - 1, finalSlot);
    const blocks: number[] =
      (await withRetry(() => connection.getBlocks(currentSlot, batchEnd))) ?? [];

    if (blocks.length === 0) {
      currentSlot = batchEnd + 1;
      continue;
    }

    for (const blockSlot of blocks) {
      let block: VersionedBlockResponse | null;
      try {
        block = await withRetry(() =>
          connection.getBlock(blockSlot, {
            maxSupportedTransactionVersion: 0,
          }),
        );
      } catch {
        logger.warn({ slot: blockSlot }, 'Failed to fetch block, skipping');
        continue;
      }

      if (!block) continue;

      for (const txEntry of block.transactions) {
        const msg = txEntry.transaction.message;
        const staticKeys = msg.staticAccountKeys.map((k) => k.toBase58());
        const loaded = txEntry.meta?.loadedAddresses;
        const accountKeys = loaded
          ? [
              ...staticKeys,
              ...loaded.writable.map((k) => k.toBase58()),
              ...loaded.readonly.map((k) => k.toBase58()),
            ]
          : staticKeys;

        const hasProgram = accountKeys.includes(programIdStr);
        if (!hasProgram) continue;

        const fullTx = {
          slot: blockSlot,
          blockTime: block.blockTime ?? null,
          transaction: txEntry.transaction,
          meta: txEntry.meta,
        } as VersionedTransactionResponse;

        yield fullTx;
        count++;
        if (count % 100 === 0) {
          logger.info({ count, slot: blockSlot }, 'Fetching progress');
        }
        if (maxTransactions && count >= maxTransactions) {
          logger.info({ total: count }, 'Reached max transactions limit');
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, baseDelayMs > 1 ? 50 : 0));
    }

    currentSlot = batchEnd + 1;
  }

  logger.info({ total: count }, 'Fetching complete');
}

export { withRetry };
