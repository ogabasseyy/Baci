import { z } from 'zod';
import { piggyvestPrimaryWalletSnapshotSchemas } from './piggyvest-primary-wallet-snapshot';
import { piggyvestPrimaryWalletStoreSchemas } from './piggyvest-primary-wallet-store';

export const primaryWalletVerificationSchemas = {
  scope: piggyvestPrimaryWalletStoreSchemas.scope,
  proof: z.strictObject({
    mapping: piggyvestPrimaryWalletSnapshotSchemas.mapping.unwrap(),
    wallet: piggyvestPrimaryWalletSnapshotSchemas.wallet,
    accounts: piggyvestPrimaryWalletSnapshotSchemas.accounts.min(1),
  }),
  result: piggyvestPrimaryWalletStoreSchemas.recordedRows,
};
