import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeInstruction, loadIdl } from '../../src/indexer/decoder';
import { encodeDepositData, encodeWithdrawData, FIXTURES } from '../fixtures/transactions';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

describe('loadIdl', () => {
  it('loads IDL from a JSON file path', async () => {
    const idl = await loadIdl({ idlPath: path.join(FIXTURES_DIR, 'idl.json') });
    expect(idl.instructions).toHaveLength(2);
    expect(idl.instructions[0].name).toBe('deposit');
    expect(idl.instructions[1].name).toBe('withdraw');
  });

  it('throws if the file does not exist', async () => {
    await expect(loadIdl({ idlPath: '/nonexistent/path.json' })).rejects.toThrow();
  });

  it('throws if the JSON is not a valid IDL', async () => {
    await expect(loadIdl({ idlPath: path.join(FIXTURES_DIR, 'invalid-idl.json') })).rejects.toThrow(
      'Invalid IDL: missing instructions array',
    );
  });
});

describe('decodeInstruction', () => {
  const { idl, userPubkey, vaultPubkey } = FIXTURES;

  it('decodes a "deposit" instruction and returns correct name and args', () => {
    const data = encodeDepositData(1_000_000);
    const result = decodeInstruction(data, [userPubkey, vaultPubkey], idl);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('deposit');
    expect(result?.args.amount).toBeDefined();
  });

  it('decodes a "withdraw" instruction with correct amount', () => {
    const data = encodeWithdrawData(500_000);
    const result = decodeInstruction(data, [userPubkey, vaultPubkey], idl);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('withdraw');
    expect(result?.args.amount).toBeDefined();
  });

  it('returns null for instruction data that does not match IDL discriminator', () => {
    const randomData = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const result = decodeInstruction(randomData, [userPubkey, vaultPubkey], idl);

    expect(result).toBeNull();
  });

  it('maps account pubkeys to IDL account names correctly', () => {
    const data = encodeDepositData(1_000_000);
    const result = decodeInstruction(data, [userPubkey, vaultPubkey], idl);

    expect(result?.accounts).toEqual([
      { name: 'user', pubkey: userPubkey },
      { name: 'vault', pubkey: vaultPubkey },
    ]);
  });

  it('handles missing accounts gracefully (returns partial)', () => {
    const data = encodeDepositData(1_000_000);
    const result = decodeInstruction(data, [userPubkey], idl);

    expect(result).not.toBeNull();
    expect(result?.accounts).toEqual([
      { name: 'user', pubkey: userPubkey },
      { name: 'vault', pubkey: 'unknown' },
    ]);
  });
});
