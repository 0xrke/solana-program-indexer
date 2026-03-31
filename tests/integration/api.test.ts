import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/api/server';
import prisma from '../../src/db/client';

let server: FastifyInstance;

beforeAll(async () => {
  server = await createServer();
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.instruction.deleteMany();
  await prisma.transaction.deleteMany();

  await prisma.transaction.create({
    data: {
      signature: 'test-sig-1',
      slot: BigInt(250000000),
      blockTime: new Date('2024-01-15T10:30:00Z'),
      fee: BigInt(5000),
      success: true,
      signers: ['signer1', 'signer2'],
      instructions: {
        create: [
          {
            programId: 'program1',
            instructionName: 'deposit',
            accounts: [{ name: 'user', pubkey: 'signer1' }],
            args: { amount: 1000000 },
            ixIndex: 0,
          },
        ],
      },
    },
  });

  await prisma.transaction.create({
    data: {
      signature: 'test-sig-2',
      slot: BigInt(250000001),
      blockTime: new Date('2024-01-15T10:31:00Z'),
      fee: BigInt(5000),
      success: true,
      signers: ['signer3'],
      instructions: {
        create: [
          {
            programId: 'program1',
            instructionName: 'withdraw',
            accounts: [{ name: 'user', pubkey: 'signer3' }],
            args: { amount: 500000 },
            ixIndex: 0,
          },
        ],
      },
    },
  });
});

describe('GET /transactions/:signature', () => {
  it('returns 200 with full decoded transaction data', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions/test-sig-1',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.signature).toBe('test-sig-1');
    expect(body.slot).toBe(250000000);
    expect(body.fee).toBe(5000);
    expect(body.success).toBe(true);
    expect(body.signers).toEqual(['signer1', 'signer2']);
  });

  it('returns 404 for unknown signature', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions/nonexistent',
    });
    expect(response.statusCode).toBe(404);
  });

  it('includes instructions array with name, accounts, args', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions/test-sig-1',
    });
    const body = JSON.parse(response.body);
    expect(body.instructions).toHaveLength(1);
    expect(body.instructions[0].name).toBe('deposit');
    expect(body.instructions[0].accounts).toEqual([{ name: 'user', pubkey: 'signer1' }]);
    expect(body.instructions[0].args).toEqual({ amount: 1000000 });
  });
});

describe('GET /transactions', () => {
  it('returns paginated list with total count', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('filters by instruction name correctly', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions?instruction=deposit',
    });
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].signature).toBe('test-sig-1');
    expect(body.total).toBe(1);
  });

  it('filters by signer pubkey correctly', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions?signer=signer3',
    });
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].signature).toBe('test-sig-2');
  });

  it('returns 400 for invalid limit (> 100)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions?limit=101',
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for negative offset', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions?offset=-1',
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns empty data array when no results match filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/transactions?instruction=nonexistent',
    });
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
