import type { FastifyInstance } from 'fastify';
import prisma from '../db/client';

function serializeTransaction(tx: {
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  fee: bigint | null;
  success: boolean;
  signers: string[];
  instructions: {
    instructionName: string;
    accounts: unknown;
    args: unknown;
  }[];
}) {
  return {
    signature: tx.signature,
    slot: Number(tx.slot),
    blockTime: tx.blockTime?.toISOString() ?? null,
    fee: tx.fee != null ? Number(tx.fee) : null,
    success: tx.success,
    signers: tx.signers,
    instructions: tx.instructions.map((ix) => ({
      name: ix.instructionName,
      accounts: ix.accounts,
      args: ix.args,
    })),
  };
}

export function registerRoutes(server: FastifyInstance): void {
  server.get('/transactions/:signature', async (request, reply) => {
    const { signature } = request.params as { signature: string };

    const tx = await prisma.transaction.findUnique({
      where: { signature },
      include: { instructions: true },
    });

    if (!tx) {
      return reply.status(404).send({ error: 'Transaction not found' });
    }

    return reply.send(serializeTransaction(tx));
  });

  server.get('/transactions', async (request, reply) => {
    const query = request.query as {
      instruction?: string;
      signer?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Number.parseInt(query.limit || '20', 10);
    const offset = Number.parseInt(query.offset || '0', 10);

    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      return reply.status(400).send({ error: 'limit must be between 1 and 100' });
    }
    if (Number.isNaN(offset) || offset < 0) {
      return reply.status(400).send({ error: 'offset must be non-negative' });
    }

    const where: Record<string, unknown> = {};

    if (query.instruction) {
      where.instructions = {
        some: { instructionName: query.instruction },
      };
    }

    if (query.signer) {
      where.signers = { has: query.signer };
    }

    const [data, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { instructions: true },
        take: limit,
        skip: offset,
        orderBy: { slot: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    return reply.send({
      data: data.map(serializeTransaction),
      total,
      limit,
      offset,
    });
  });
}
