import 'server-only';
import { primaryWalletCardFundingSchemas as schemas } from '@/schemas/primary-wallet-card-funding';
import type { PrimaryWalletCardFundingDependencies } from './primary-wallet-card-funding.types';
import { verifyPrimaryWalletCardFundingProof } from './primary-wallet-card-funding-proof';

export function createPrimaryWalletCardFundingConnection(
  trustedScope: unknown,
  dependencies: PrimaryWalletCardFundingDependencies
) {
  const scope = schemas.scope.parse(trustedScope);
  return async (operationId: unknown) => {
    try {
      const selection = schemas.selection.parse({ ...scope, operationId });
      const reservation = schemas.reservation.parse(
        await dependencies.readReservation(selection)
      );
      if (
        reservation.operationId !== selection.operationId ||
        reservation.environment !== scope.environment ||
        reservation.integrationId !== scope.integrationId ||
        reservation.merchantId !== scope.merchantId ||
        reservation.customerId !== scope.customerId
      )
        return { status: 'reconciliation_required' as const };
      const collection = await dependencies.verifyCollection(reservation);
      const collectionProof = verifyPrimaryWalletCardFundingProof({
        reservation,
        collection,
        transfer: null,
      });
      if (collectionProof.status !== 'custody_pending') return collectionProof;
      const proof = verifyPrimaryWalletCardFundingProof({
        reservation,
        collection,
        transfer: await dependencies.verifyTransfer(reservation),
      });
      if (proof.status !== 'ready_to_credit') return { status: proof.status };
      const result = schemas.acknowledgement.parse(
        await dependencies.settleVerifiedCustody(proof.proof)
      );
      return {
        status: result === 'conflict' ? 'reconciliation_required' : 'completed',
      } as const;
    } catch {
      return { status: 'reconciliation_required' as const };
    }
  };
}
