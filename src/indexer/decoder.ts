import fs from 'node:fs';
import { BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';

export interface DecodedInstruction {
  name: string;
  accounts: { name: string; pubkey: string }[];
  args: Record<string, unknown>;
}

export async function loadIdl(options: {
  idlPath?: string;
  idlAddress?: string;
  rpcUrl?: string;
}): Promise<Idl> {
  if (options.idlPath) {
    const raw = fs.readFileSync(options.idlPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.instructions || !Array.isArray(parsed.instructions)) {
      throw new Error('Invalid IDL: missing instructions array');
    }
    return parsed as Idl;
  }

  if (options.idlAddress && options.rpcUrl) {
    const { Program, AnchorProvider, Wallet } = await import('@coral-xyz/anchor');
    const { Connection, Keypair } = await import('@solana/web3.js');
    const connection = new Connection(options.rpcUrl);
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(connection, wallet, {});
    const idl = await Program.fetchIdl(options.idlAddress, provider);
    if (!idl) {
      throw new Error(`Failed to fetch IDL from address: ${options.idlAddress}`);
    }
    return idl;
  }

  throw new Error('Either idlPath or idlAddress must be provided');
}

export function decodeInstruction(
  data: Buffer,
  accountKeys: string[],
  idl: Idl,
): DecodedInstruction | null {
  try {
    const coder = new BorshInstructionCoder(idl);
    const decoded = coder.decode(data);

    if (!decoded) return null;

    const ixDef = idl.instructions.find((ix) => ix.name === decoded.name);
    if (!ixDef) return null;

    const accounts = ixDef.accounts.map((acc, idx) => ({
      name: 'name' in acc ? acc.name : 'unknown',
      pubkey: accountKeys[idx] || 'unknown',
    }));

    return {
      name: decoded.name,
      accounts,
      args: decoded.data as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
