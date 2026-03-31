import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSignaturesForAddress = vi.fn();
const mockGetTransaction = vi.fn();
const mockGetBlocks = vi.fn();
const mockGetBlock = vi.fn();
const mockGetSlot = vi.fn();

vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { PublicKey } from '@solana/web3.js';
import type { FetchBySignatureOptions, FetchBySlotOptions } from '../../src/indexer/fetcher';
import {
  fetchTransactionsBySignature,
  fetchTransactionsBySlot,
  setBaseDelay,
} from '../../src/indexer/fetcher';

setBaseDelay(1);

const PROGRAM_ID = '11111111111111111111111111111111';

function createMockTx(signature: string) {
  return {
    slot: 250000000,
    blockTime: 1705312200,
    transaction: { signatures: [signature], message: {} },
    meta: { fee: 5000, err: null },
  };
}

function createMockSignatureConnection() {
  return {
    getSignaturesForAddress: mockGetSignaturesForAddress,
    getTransaction: mockGetTransaction,
  } as unknown as FetchBySignatureOptions['connection'];
}

function createMockSlotConnection() {
  return {
    getBlocks: mockGetBlocks,
    getBlock: mockGetBlock,
    getSlot: mockGetSlot,
  } as unknown as FetchBySlotOptions['connection'];
}

function createMockBlock(_slot: number, programId: string, signatures: string[]) {
  return {
    blockTime: 1705312200,
    transactions: signatures.map((sig) => ({
      transaction: {
        signatures: [sig],
        message: {
          staticAccountKeys: [new PublicKey(programId)],
          compiledInstructions: [],
          header: {
            numRequiredSignatures: 1,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 0,
          },
          recentBlockhash: 'fake',
        },
      },
      meta: { fee: 5000, err: null, loadedAddresses: undefined },
    })),
  };
}

describe('fetchTransactionsBySignature', () => {
  const connection = createMockSignatureConnection();
  const programId = new PublicKey(PROGRAM_ID);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields transactions from getSignaturesForAddress in batches', async () => {
    mockGetSignaturesForAddress
      .mockResolvedValueOnce([
        { signature: 'sig1', err: null },
        { signature: 'sig2', err: null },
      ])
      .mockResolvedValueOnce([]);

    mockGetTransaction
      .mockResolvedValueOnce(createMockTx('sig1'))
      .mockResolvedValueOnce(createMockTx('sig2'));

    const results = [];
    for await (const tx of fetchTransactionsBySignature({
      connection,
      programId,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(2);
    expect(mockGetSignaturesForAddress).toHaveBeenCalledTimes(2);
  });

  it('stops at END_SIGNATURE boundary', async () => {
    mockGetSignaturesForAddress.mockResolvedValueOnce([]);

    const results = [];
    for await (const tx of fetchTransactionsBySignature({
      connection,
      programId,
      batchSize: 10,
      endSignature: 'end-sig',
    })) {
      results.push(tx);
    }

    expect(mockGetSignaturesForAddress).toHaveBeenCalledWith(
      programId,
      expect.objectContaining({ until: 'end-sig' }),
    );
  });

  it('retries on RPC rate limit error (429) with exponential backoff', async () => {
    mockGetSignaturesForAddress
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce([{ signature: 'sig1', err: null }])
      .mockResolvedValueOnce([]);

    mockGetTransaction.mockResolvedValueOnce(createMockTx('sig1'));

    const results = [];
    for await (const tx of fetchTransactionsBySignature({
      connection,
      programId,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(1);
    expect(mockGetSignaturesForAddress).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exceeded', async () => {
    mockGetSignaturesForAddress.mockRejectedValue(new Error('429 Too Many Requests'));

    const generator = fetchTransactionsBySignature({ connection, programId, batchSize: 10 });

    await expect(generator.next()).rejects.toThrow('429 Too Many Requests');
  });

  it('skips transactions that failed on-chain (err !== null)', async () => {
    mockGetSignaturesForAddress
      .mockResolvedValueOnce([
        { signature: 'sig1', err: null },
        { signature: 'sig-failed', err: { InstructionError: [0, 'Custom'] } },
        { signature: 'sig2', err: null },
      ])
      .mockResolvedValueOnce([]);

    mockGetTransaction
      .mockResolvedValueOnce(createMockTx('sig1'))
      .mockResolvedValueOnce(createMockTx('sig2'));

    const results = [];
    for await (const tx of fetchTransactionsBySignature({
      connection,
      programId,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(2);
    expect(mockGetTransaction).toHaveBeenCalledTimes(2);
  });

  it('handles empty signature list gracefully (yields nothing)', async () => {
    mockGetSignaturesForAddress.mockResolvedValueOnce([]);

    const results = [];
    for await (const tx of fetchTransactionsBySignature({
      connection,
      programId,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(0);
  });
});

describe('fetchTransactionsBySlot', () => {
  const connection = createMockSlotConnection();
  const programId = new PublicKey(PROGRAM_ID);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields transactions from blocks in slot range', async () => {
    mockGetBlocks.mockResolvedValueOnce([100, 101]);

    mockGetBlock
      .mockResolvedValueOnce(createMockBlock(100, PROGRAM_ID, ['sig1']))
      .mockResolvedValueOnce(createMockBlock(101, PROGRAM_ID, ['sig2']));

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      endSlot: 101,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(2);
    expect(mockGetBlocks).toHaveBeenCalledWith(100, 101);
  });

  it('stops at endSlot boundary and paginates batches', async () => {
    // First batch: slots 100-104, second batch: slots 105-109, returns empty
    mockGetBlocks.mockResolvedValueOnce([100, 102, 104]).mockResolvedValueOnce([]);

    mockGetBlock
      .mockResolvedValueOnce(createMockBlock(100, PROGRAM_ID, ['sig1']))
      .mockResolvedValueOnce(createMockBlock(102, PROGRAM_ID, ['sig2']))
      .mockResolvedValueOnce(createMockBlock(104, PROGRAM_ID, ['sig3']));

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      endSlot: 109,
      batchSize: 5,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(3);
    expect(mockGetBlocks).toHaveBeenCalledTimes(2);
    expect(mockGetBlocks).toHaveBeenNthCalledWith(1, 100, 104);
    expect(mockGetBlocks).toHaveBeenNthCalledWith(2, 105, 109);
  });

  it('filters transactions by programId', async () => {
    const otherProgram = '22222222222222222222222222222222222222222222';
    mockGetBlocks.mockResolvedValueOnce([100]);

    const block = {
      blockTime: 1705312200,
      transactions: [
        ...createMockBlock(100, PROGRAM_ID, ['sig-match']).transactions,
        ...createMockBlock(100, otherProgram, ['sig-other']).transactions,
      ],
    };
    mockGetBlock.mockResolvedValueOnce(block);

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      endSlot: 100,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(1);
    expect(results[0].transaction.signatures[0]).toBe('sig-match');
  });

  it('respects maxTransactions limit', async () => {
    mockGetBlocks.mockResolvedValueOnce([100, 101]);
    mockGetBlock
      .mockResolvedValueOnce(createMockBlock(100, PROGRAM_ID, ['sig1', 'sig2', 'sig3']))
      .mockResolvedValueOnce(createMockBlock(101, PROGRAM_ID, ['sig4']));

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      endSlot: 101,
      batchSize: 10,
      maxTransactions: 2,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(2);
  });

  it('handles empty block list gracefully', async () => {
    mockGetBlocks.mockResolvedValue([]);

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      endSlot: 109,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(results).toHaveLength(0);
  });

  it('uses current slot as endSlot when not specified', async () => {
    mockGetSlot.mockResolvedValueOnce(105);
    mockGetBlocks.mockResolvedValueOnce([100, 101]); // endSlot=105, batchEnd=min(109,105)=105

    mockGetBlock
      .mockResolvedValueOnce(createMockBlock(100, PROGRAM_ID, ['sig1']))
      .mockResolvedValueOnce(createMockBlock(101, PROGRAM_ID, ['sig2']));

    const results = [];
    for await (const tx of fetchTransactionsBySlot({
      connection,
      programId,
      startSlot: 100,
      batchSize: 10,
    })) {
      results.push(tx);
    }

    expect(mockGetSlot).toHaveBeenCalledTimes(1);
    expect(mockGetBlocks).toHaveBeenCalledWith(100, 105);
    expect(results).toHaveLength(2);
  });
});
