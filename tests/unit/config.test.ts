import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const validEnv = {
  RPC_URL: 'https://api.mainnet-beta.solana.com',
  PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/indexer',
  IDL_PATH: './idl/example.json',
};

describe('config validation', () => {
  it('throws if RPC_URL is missing', () => {
    const env = { ...validEnv, RPC_URL: undefined };
    expect(() => loadConfig(env)).toThrow('Missing required environment variable: RPC_URL');
  });

  it('throws if PROGRAM_ID is missing', () => {
    const env = { ...validEnv, PROGRAM_ID: undefined };
    expect(() => loadConfig(env)).toThrow('Missing required environment variable: PROGRAM_ID');
  });

  it('throws if both IDL_PATH and IDL_ADDRESS are missing', () => {
    const env = { ...validEnv, IDL_PATH: undefined, IDL_ADDRESS: undefined };
    expect(() => loadConfig(env)).toThrow(
      'At least one of IDL_PATH or IDL_ADDRESS must be provided',
    );
  });

  it('parses BATCH_SIZE as number with default 100', () => {
    const config = loadConfig(validEnv);
    expect(config.batchSize).toBe(100);

    const configWith50 = loadConfig({ ...validEnv, BATCH_SIZE: '50' });
    expect(configWith50.batchSize).toBe(50);
  });

  it('parses optional slot range correctly', () => {
    const config = loadConfig({
      ...validEnv,
      START_SLOT: '1000',
      END_SLOT: '2000',
    });
    expect(config.startSlot).toBe(1000);
    expect(config.endSlot).toBe(2000);
  });

  it('loads successfully with valid env', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      databaseUrl: 'postgresql://user:pass@localhost:5432/indexer',
      idlPath: './idl/example.json',
      idlAddress: undefined,
      startSlot: undefined,
      endSlot: undefined,
      startSignature: undefined,
      endSignature: undefined,
      batchSize: 100,
    });
  });
});
