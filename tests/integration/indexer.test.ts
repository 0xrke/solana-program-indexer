import { BN, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/db/client';
import idl from '../fixtures/idl.json';

vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const PROGRAM_ID = '11111111111111111111111111111111';
const USER_KEY = 'FUZdNY1DPRRFj7GBw4NuZKu6YVvUkXNcw4qZ3LgHCtcp';
const VAULT_KEY = '8ZN5YWSbzY7JV7YhAs9GT6RKAzcFD4Nd4t8NYkRvQVFA';

const coder = new BorshInstructionCoder(idl as Idl);

function createMockVersionedTx(signature: string, instructionName: string, amount: number) {
  const encodedData = coder.encode(instructionName, { amount: new BN(amount) });

  return {
    slot: 250000000,
    blockTime: 1705312200,
    transaction: {
      signatures: [signature],
      message: {
        staticAccountKeys: [
          new PublicKey(USER_KEY),
          new PublicKey(VAULT_KEY),
          new PublicKey(PROGRAM_ID),
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1,
        },
        compiledInstructions: [
          {
            programIdIndex: 2,
            accountKeyIndexes: [0, 1],
            data: new Uint8Array(encodedData),
          },
        ],
        recentBlockhash: 'fake',
        getAccountKeys: () => ({
          staticAccountKeys: [
            new PublicKey(USER_KEY),
            new PublicKey(VAULT_KEY),
            new PublicKey(PROGRAM_ID),
          ],
        }),
      },
    },
    meta: {
      fee: 5000,
      err: null,
      loadedAddresses: { writable: [], readonly: [] },
    },
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.instruction.deleteMany();
  await prisma.transaction.deleteMany();
});

describe('indexer pipeline', () => {
  it('fetches, decodes, and persists transactions end-to-end', async () => {
    const mockTx = createMockVersionedTx('sig-deposit-1', 'deposit', 1_000_000);

    const mockGetSignaturesForAddress = vi
      .fn()
      .mockResolvedValueOnce([{ signature: 'sig-deposit-1', err: null }])
      .mockResolvedValueOnce([]);
    const mockGetTransaction = vi.fn().mockResolvedValueOnce(mockTx);

    const { fetchTransactionsBySignature, setBaseDelay } = await import('../../src/indexer/fetcher');
    setBaseDelay(1);

    const mockConnection = {
      getSignaturesForAddress: mockGetSignaturesForAddress,
      getTransaction: mockGetTransaction,
    } as unknown as import('@solana/web3.js').Connection;

    const { loadIdl, decodeInstruction } = await import('../../src/indexer/decoder');
    const loadedIdl = await loadIdl({ idlPath: `${__dirname}/../fixtures/idl.json` });

    const programId = new PublicKey(PROGRAM_ID);
    const generator = fetchTransactionsBySignature({
      connection: mockConnection,
      programId,
      batchSize: 10,
    });

    for await (const tx of generator) {
      const signature = tx.transaction.signatures[0];

      await prisma.$transaction(async (client) => {
        const dbTx = await client.transaction.upsert({
          where: { signature },
          create: {
            signature,
            slot: BigInt(tx.slot),
            blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
            fee: tx.meta?.fee != null ? BigInt(tx.meta.fee) : null,
            success: tx.meta?.err === null,
            signers: [USER_KEY],
          },
          update: {},
        });

        const msg = tx.transaction.message;
        let allKeys: string[] = [];
        if ('staticAccountKeys' in msg) {
          allKeys = (msg.staticAccountKeys as PublicKey[]).map((k) => k.toBase58());
        }

        if ('compiledInstructions' in msg) {
          for (let i = 0; i < msg.compiledInstructions.length; i++) {
            const ix = msg.compiledInstructions[i];
            if (allKeys[ix.programIdIndex] === PROGRAM_ID) {
              const ixKeys = ix.accountKeyIndexes.map((idx: number) => allKeys[idx]);
              const decoded = decodeInstruction(Buffer.from(ix.data), ixKeys, loadedIdl);

              await client.instruction.create({
                data: {
                  transactionId: dbTx.id,
                  programId: PROGRAM_ID,
                  instructionName: decoded?.name ?? 'unknown',
                  accounts: decoded?.accounts ?? [],
                  args: decoded?.args ?? {},
                  ixIndex: i,
                },
              });
            }
          }
        }
      });
    }

    const txCount = await prisma.transaction.count();
    expect(txCount).toBe(1);

    const savedTx = await prisma.transaction.findUnique({
      where: { signature: 'sig-deposit-1' },
      include: { instructions: true },
    });
    expect(savedTx).not.toBeNull();
    expect(savedTx?.success).toBe(true);
    expect(savedTx?.instructions).toHaveLength(1);
    expect(savedTx?.instructions[0].instructionName).toBe('deposit');
  });

  it('skips duplicate transactions (upsert / unique constraint)', async () => {
    await prisma.transaction.create({
      data: {
        signature: 'sig-dup-1',
        slot: BigInt(250000000),
        fee: BigInt(5000),
        success: true,
        signers: [USER_KEY],
      },
    });

    const result = await prisma.transaction.upsert({
      where: { signature: 'sig-dup-1' },
      create: {
        signature: 'sig-dup-1',
        slot: BigInt(999999),
        fee: BigInt(9999),
        success: false,
        signers: [],
      },
      update: {},
    });

    expect(result.slot).toBe(BigInt(250000000));

    const count = await prisma.transaction.count({ where: { signature: 'sig-dup-1' } });
    expect(count).toBe(1);
  });

  it('stores unknown instruction name when decode returns null', async () => {
    const dbTx = await prisma.transaction.create({
      data: {
        signature: 'sig-unknown-1',
        slot: BigInt(250000000),
        fee: BigInt(5000),
        success: true,
        signers: [USER_KEY],
      },
    });

    await prisma.instruction.create({
      data: {
        transactionId: dbTx.id,
        programId: PROGRAM_ID,
        instructionName: 'unknown',
        accounts: [],
        args: {},
        ixIndex: 0,
      },
    });

    const ix = await prisma.instruction.findFirst({
      where: { transactionId: dbTx.id },
    });
    expect(ix?.instructionName).toBe('unknown');
    expect(ix?.args).toEqual({});
  });

  it('correctly links instructions to parent transaction', async () => {
    const dbTx = await prisma.transaction.create({
      data: {
        signature: 'sig-linked-1',
        slot: BigInt(250000000),
        fee: BigInt(5000),
        success: true,
        signers: [USER_KEY],
        instructions: {
          create: [
            {
              programId: PROGRAM_ID,
              instructionName: 'deposit',
              accounts: [{ name: 'user', pubkey: USER_KEY }],
              args: { amount: 1000000 },
              ixIndex: 0,
            },
            {
              programId: PROGRAM_ID,
              instructionName: 'withdraw',
              accounts: [{ name: 'user', pubkey: USER_KEY }],
              args: { amount: 500000 },
              ixIndex: 1,
            },
          ],
        },
      },
      include: { instructions: true },
    });

    expect(dbTx.instructions).toHaveLength(2);

    const instructions = await prisma.instruction.findMany({
      where: { transactionId: dbTx.id },
      orderBy: { ixIndex: 'asc' },
    });
    expect(instructions[0].instructionName).toBe('deposit');
    expect(instructions[1].instructionName).toBe('withdraw');
    expect(instructions[0].transactionId).toBe(dbTx.id);
    expect(instructions[1].transactionId).toBe(dbTx.id);
  });
});
