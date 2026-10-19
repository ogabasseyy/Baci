import type { z } from 'zod';
import type { primaryWalletCardFundingSchemas } from '@/schemas/primary-wallet-card-funding';
import type { verifyPrimaryWalletCardFundingProof } from './primary-wallet-card-funding-proof';

type Selection = z.infer<typeof primaryWalletCardFundingSchemas.selection>;
type Reservation = z.infer<typeof primaryWalletCardFundingSchemas.reservation>;
type Ready = Extract<
  ReturnType<typeof verifyPrimaryWalletCardFundingProof>,
  { status: 'ready_to_credit' }
>;

export interface PrimaryWalletCardFundingDependencies {
  readReservation(selection: Selection): Promise<unknown>;
  verifyCollection(reservation: Reservation): Promise<unknown>;
  verifyTransfer(reservation: Reservation): Promise<unknown>;
  settleVerifiedCustody(proof: Ready['proof']): Promise<unknown>;
}
