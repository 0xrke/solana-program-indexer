import { BN, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import idl from './idl.json';

const PROGRAM_ID = '11111111111111111111111111111111';
const USER_PUBKEY = 'FUZdNY1DPRRFj7GBw4NuZKu6YVvUkXNcw4qZ3LgHCtcp';
const VAULT_PUBKEY = '8ZN5YWSbzY7JV7YhAs9GT6RKAzcFD4Nd4t8NYkRvQVFA';

const coder = new BorshInstructionCoder(idl as Idl);

export function encodeDepositData(amount: number): Buffer {
  return Buffer.from(coder.encode('deposit', { amount: new BN(amount) }));
}

export function encodeWithdrawData(amount: number): Buffer {
  return Buffer.from(coder.encode('withdraw', { amount: new BN(amount) }));
}

export const FIXTURES = {
  programId: PROGRAM_ID,
  userPubkey: USER_PUBKEY,
  vaultPubkey: VAULT_PUBKEY,
  idl: idl as Idl,
};
