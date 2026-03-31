import type { Idl } from '@coral-xyz/anchor';
import type { Prisma } from '@prisma/client';
import { Connection, PublicKey, type VersionedTransactionResponse } from '@solana/web3.js';
import pino from 'pino';
import type { Config } from '../config';
import prisma from '../db/client';
import { decodeInstruction, loadIdl } from './decoder';
import { fetchTransactionsBySignature, fetchTransactionsBySlot } from './fetcher';

const logger = pino({ name: 'runner' });

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function extractSigners(tx: VersionedTransactionResponse): string[] {
  const msg = tx.transaction.message;
  if ('accountKeys' in msg) {
    const numSigners = ('header' in msg && msg.header?.numRequiredSignatures) || 1;
    return msg.accountKeys.slice(0, numSigners).map((k) => k.toBase58());
  }
  if ('staticAccountKeys' in msg) {
    const numSigners = msg.header.numRequiredSignatures;
    return msg.staticAccountKeys.slice(0, numSigners).map((k) => k.toBase58());
  }
  return [];
}

function extractInstructions(
  tx: VersionedTransactionResponse,
  programIdStr: string,
): { data: Buffer; accountKeys: string[] }[] {
  const msg = tx.transaction.message;
  const results: { data: Buffer; accountKeys: string[] }[] = [];

  let allKeys: string[];
  if ('accountKeys' in msg) {
    allKeys = msg.accountKeys.map((k) => k.toBase58());
  } else if ('staticAccountKeys' in msg) {
    allKeys = msg.staticAccountKeys.map((k) => k.toBase58());
    const lookup = tx.meta?.loadedAddresses;
    if (lookup) {
      allKeys = [
        ...allKeys,
        ...lookup.writable.map((k) => k.toBase58()),
        ...lookup.readonly.map((k) => k.toBase58()),
      ];
    }
  } else {
    return [];
  }

  if ('compiledInstructions' in msg) {
    for (const ix of msg.compiledInstructions) {
      if (allKeys[ix.programIdIndex] === programIdStr) {
        const ixAccountKeys = ix.accountKeyIndexes.map((i) => allKeys[i]);
        results.push({ data: Buffer.from(ix.data), accountKeys: ixAccountKeys });
      }
    }
  } else if ('instructions' in msg) {
    const legacyInstructions = (
      msg as { instructions: { programIdIndex: number; accounts: number[]; data: string }[] }
    ).instructions;
    for (const ix of legacyInstructions) {
      if (allKeys[ix.programIdIndex] === programIdStr) {
        const ixAccountKeys = ix.accounts.map((idx: number) => allKeys[idx]);
        results.push({
          data: Buffer.from(ix.data, 'base64'),
          accountKeys: ixAccountKeys,
        });
      }
    }
  }

  return results;
}

async function processTransaction(
  tx: VersionedTransactionResponse,
  idl: Idl,
  programIdStr: string,
): Promise<void> {
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
        signers: extractSigners(tx),
        raw: JSON.parse(JSON.stringify(tx, bigintReplacer)),
      },
      update: {},
    });

    const instructions = extractInstructions(tx, programIdStr);
    for (let i = 0; i < instructions.length; i++) {
      const decoded = decodeInstruction(instructions[i].data, instructions[i].accountKeys, idl);

      await client.instruction.create({
        data: {
          transactionId: dbTx.id,
          programId: programIdStr,
          instructionName: decoded?.name ?? 'unknown',
          accounts: (decoded?.accounts ?? []) as Prisma.InputJsonValue,
          args: (decoded?.args ?? {}) as Prisma.InputJsonValue,
          ixIndex: i,
        },
      });
    }
  });
}

export async function runIndexer(config: Config): Promise<void> {
  const idl = await loadIdl({
    idlPath: config.idlPath,
    idlAddress: config.idlAddress,
    rpcUrl: config.rpcUrl,
  });
  logger.info('IDL loaded');

  const connection = new Connection(config.rpcUrl, 'confirmed');
  const programId = new PublicKey(config.programId);
  const programIdStr = programId.toBase58();

  const useSlotMode = config.startSlot != null;

  const generator = useSlotMode
    ? fetchTransactionsBySlot({
        connection,
        programId,
        startSlot: config.startSlot as number,
        endSlot: config.endSlot,
        batchSize: config.batchSize,
        maxTransactions: config.maxTransactions,
      })
    : fetchTransactionsBySignature({
        connection,
        programId,
        startSignature: config.startSignature,
        endSignature: config.endSignature,
        batchSize: config.batchSize,
        maxTransactions: config.maxTransactions,
      });

  logger.info({ mode: useSlotMode ? 'slot' : 'signature' }, 'Indexing mode selected');

  let total = 0;
  const startTime = Date.now();

  for await (const tx of generator) {
    await processTransaction(tx, idl, programIdStr);
    total++;
    if (total % 100 === 0) {
      logger.info({ total }, 'Transactions indexed');
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info({ total, elapsed: `${elapsed}s` }, 'Indexing complete');
}
