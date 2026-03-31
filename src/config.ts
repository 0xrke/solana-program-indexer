export interface Config {
  rpcUrl: string;
  programId: string;
  idlPath?: string;
  idlAddress?: string;
  databaseUrl: string;
  startSlot?: number;
  endSlot?: number;
  startSignature?: string;
  endSignature?: string;
  batchSize: number;
  maxTransactions?: number;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const rpcUrl = requireEnv(env, 'RPC_URL');
  const programId = requireEnv(env, 'PROGRAM_ID');
  const databaseUrl = requireEnv(env, 'DATABASE_URL');

  const idlPath = env.IDL_PATH || undefined;
  const idlAddress = env.IDL_ADDRESS || undefined;

  if (!idlPath && !idlAddress) {
    throw new Error('At least one of IDL_PATH or IDL_ADDRESS must be provided');
  }

  const batchSize = parseOptionalInt(env.BATCH_SIZE) ?? 100;
  const startSlot = parseOptionalInt(env.START_SLOT);
  const endSlot = parseOptionalInt(env.END_SLOT);
  const startSignature = env.START_SIGNATURE || undefined;
  const endSignature = env.END_SIGNATURE || undefined;

  const maxTransactions = parseOptionalInt(env.MAX_TRANSACTIONS);

  return {
    rpcUrl,
    programId,
    idlPath,
    idlAddress,
    databaseUrl,
    startSlot,
    endSlot,
    startSignature,
    endSignature,
    batchSize,
    maxTransactions,
  };
}
