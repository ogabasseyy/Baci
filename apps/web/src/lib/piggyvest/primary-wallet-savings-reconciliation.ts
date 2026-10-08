import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { verifyPrimaryWalletSavingsProof } from './primary-wallet-savings-proof';

type VerifiedProof = Extract<
  ReturnType<typeof verifyPrimaryWalletSavingsProof>,
  { status: 'verified' }
>;
interface Ports {
  loadDispatched: (operationId: string) => Promise<unknown>;
  queryProvider: (selection: {
    reference: string;
    walletId: string;
  }) => Promise<unknown>;
  settle: (
    proof: VerifiedProof
  ) => Promise<'confirmed' | 'duplicate' | 'conflict'>;
}

export async function reconcilePrimaryWalletSavings(
  input: unknown,
  ports: Ports
) {
  const operationId = schemas.request.shape.operationId.parse(input);
  try {
    const reservation = schemas.reserved.safeParse(
      await ports.loadDispatched(operationId)
    );
    if (!reservation.success || reservation.data.operationId !== operationId)
      return { status: 'pending' as const };
    const response = await ports.queryProvider({
      reference: reservation.data.reference,
      walletId: reservation.data.sourceWalletId,
    });
    const proof = verifyPrimaryWalletSavingsProof(reservation.data, response);
    if (proof.status !== 'verified') return { status: 'pending' as const };
    const result = await ports.settle(proof);
    return {
      status:
        result === 'confirmed' || result === 'duplicate'
          ? ('confirmed' as const)
          : ('pending' as const),
    };
  } catch {
    return { status: 'pending' as const };
  }
}
