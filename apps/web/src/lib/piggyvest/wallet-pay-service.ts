import 'server-only';
import { piggyvestWalletPaySchemas as schemas } from '@/schemas/piggyvest-wallet-pay';
import { createWalletPayPorts, type WalletPayPorts } from './wallet-pay-ports';
import {
  reconcileWalletPayTransfer,
  type WalletPayTransferKind,
} from './wallet-pay-reconciliation';
import { driveWalletRefund } from './wallet-pay-refund';
import type { WalletPayRuntime } from './wallet-pay-runtime';
import { submitWalletPayment } from './wallet-pay-transfer';

// The public surface the IMEI and VTU routes use. Callers pick the runtime:
// readWalletPayRuntime() (flag-gated) to issue or pay, and
// readWalletPayRecoveryRuntime() for status, delivery and refunds.

function reconcile(
  ports: WalletPayPorts,
  kind: WalletPayTransferKind,
  operationId: string,
  reference?: string
) {
  return reconcileWalletPayTransfer(
    { kind, operationId, reference },
    {
      loadDispatched: ports.evidence.loadDispatched,
      queryProvider: ports.queryProvider,
      settle: ports.evidence.settle,
      release: ports.evidence.release,
    }
  );
}

export async function issueWalletPayment(input: {
  runtime: WalletPayRuntime;
  scope: unknown;
  request: unknown;
}) {
  const ports = createWalletPayPorts(input.runtime);
  return await ports.customerStore(input.scope).issue(input.request);
}

/**
 * The wallet_pay PIN binding of a live issued payment, built from the
 * database row (amount, purchase and attempt), never from the request. Null
 * for an unknown, expired or foreign id, so no proof slot is spent on it.
 */
export async function readWalletPayPinBinding(input: {
  runtime: WalletPayRuntime;
  scope: unknown;
  operationId: unknown;
}) {
  const ports = createWalletPayPorts(input.runtime);
  const issued = await ports
    .customerStore(input.scope)
    .readIssued(schemas.operationId.parse(input.operationId));
  if (!issued) return null;
  return {
    binding: {
      purpose: 'wallet_pay' as const,
      amountKobo: issued.amountKobo,
      idempotencyKeySha256: issued.pinKeySha256,
    },
    // What the payment is for, so a route can refuse a proof for another
    // purchase than the one in its URL.
    purchase: { purpose: issued.purpose, purchaseRef: issued.purchaseRef },
  };
}

/** Spend the PIN proof, reserve, check both wallets and POST at most once. */
export async function payFromWallet(input: {
  runtime: WalletPayRuntime;
  scope: unknown;
  operationId: unknown;
  pinProof: string;
}) {
  const ports = createWalletPayPorts(input.runtime);
  const store = ports.customerStore(input.scope);
  const operationId = schemas.operationId.parse(input.operationId);
  const result = await submitWalletPayment(
    { operationId },
    {
      collectionWalletId: input.runtime.collectionWalletId,
      reserve: (id) => store.reserve(id, input.pinProof),
      retrieveWallet: ports.retrieveWallet,
      claimDispatch: (id) => store.manage(id, 'dispatch'),
      cancelBeforeDispatch: (id) => store.manage(id, 'cancel'),
      releaseAfterRejection: (id) => store.manage(id, 'release'),
      lookupTransfer: ports.lookupTransfer,
      transfer: (reservation) =>
        ports.transfer(reservation, 'Ogabassey purchase'),
    }
  );
  if (result.status !== 'pending') return result;
  // PiggyVest may already show the transfer; if not, the status path,
  // webhook and drain conclude it later.
  const outcome = await reconcile(ports, 'payment', operationId);
  return { status: outcome === 'released' ? ('released' as const) : outcome };
}

/**
 * Status for the customer's polling. It never sends money: a stale reserved
 * attempt is released (nothing was sent), a dispatched one is reconciled from
 * PiggyVest's record, then the stored state is returned. Null = not theirs.
 */
export async function checkWalletPayment(input: {
  runtime: WalletPayRuntime;
  scope: unknown;
  operationId: unknown;
}) {
  const ports = createWalletPayPorts(input.runtime);
  const store = ports.customerStore(input.scope);
  const operationId = schemas.operationId.parse(input.operationId);
  const before = await store.readStatus(operationId);
  if (!before) return null;
  if (before.state === 'reserved')
    await store.manage(operationId, 'cancel_stale').catch(() => false);
  else if (before.state === 'dispatched')
    await reconcile(ports, 'payment', operationId);
  else if (before.refund === 'dispatched')
    await reconcile(ports, 'refund', operationId);
  else return before;
  return await store.readStatus(operationId);
}

/**
 * Sends the refund owed for one payment (if any), then tries to conclude a
 * dispatched refund from PiggyVest's record. Safe to call any number of
 * times: the database owns whether a refund is owed and the one-shot send
 * claims each attempt before posting.
 */
export async function refundWalletPayment(input: {
  runtime: WalletPayRuntime;
  paymentId: unknown;
}) {
  const ports = createWalletPayPorts(input.runtime);
  const paymentId = schemas.operationId.parse(input.paymentId);
  const sent = await driveWalletRefund(
    { paymentId },
    {
      collectionWalletId: input.runtime.collectionWalletId,
      readOwed: ports.worker.readOwedRefund,
      retrieveWallet: ports.retrieveWallet,
      claimDispatch: (id) => ports.worker.manageRefund(id, 'dispatch'),
      releaseAfterRejection: (id) => ports.worker.manageRefund(id, 'release'),
      lookupTransfer: ports.lookupTransfer,
      transfer: (refund) => ports.transfer(refund, 'Ogabassey refund'),
    }
  );
  if (sent === 'unavailable' || sent === 'unfunded' || sent === 'released')
    return sent;
  if (
    sent === 'none' &&
    (await ports.evidence.loadDispatched('refund', paymentId)) === null
  )
    return 'none';
  return await reconcile(ports, 'refund', paymentId);
}

/**
 * Outflow webhook attribution: the first reference that names a wallet pay
 * payment or refund is reconciled through the same proof the status path
 * uses. 'unmatched' means none of the references is ours.
 */
export async function reconcileWalletPayReferences(input: {
  runtime: WalletPayRuntime;
  references: readonly string[];
}) {
  const ports = createWalletPayPorts(input.runtime);
  for (const reference of input.references) {
    const found = await ports.evidence.findByReference(reference);
    if (!found) continue;
    // Already concluded (status path won the race): acknowledge the webhook.
    if (found.settled) return 'confirmed' as const;
    return await reconcile(
      ports,
      found.kind,
      found.operationId,
      found.reference
    );
  }
  return 'unmatched' as const;
}

/** This customer's live wallet payment for one purchase, or null. */
export async function findWalletPaymentForPurchase(input: {
  runtime: WalletPayRuntime;
  scope: unknown;
  purpose: 'imei_check' | 'vtu';
  purchaseRef: string;
}) {
  const ports = createWalletPayPorts(input.runtime);
  return await ports
    .customerStore(input.scope)
    .readForPurchase(input.purpose, input.purchaseRef);
}

/** Delivery claim and outcome for confirmed payments (worker side). */
export function walletPayDelivery(runtime: WalletPayRuntime) {
  const { worker } = createWalletPayPorts(runtime);
  return {
    claim: (operationId: string) => worker.claim(operationId),
    finish: (
      operationId: string,
      outcome: 'fulfilled' | 'failed',
      claimToken: string
    ) => worker.finish(operationId, outcome, claimToken),
    isImeiDelivered: (operationId: string) =>
      worker.isImeiDelivered(operationId),
  };
}
