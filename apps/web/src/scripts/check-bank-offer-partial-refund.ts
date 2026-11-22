import { z } from 'zod';

const kobo = z.number().int().nonnegative();
const itemId = z.uuid().transform((value) => value.toLowerCase());
const decimalId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const units = z
  .array(
    z.strictObject({
      itemId,
      unitNumber: z.number().int().positive(),
    })
  )
  .min(1);

export const partialRefundManifestSchema = z.strictObject({
  units,
  previousRefunds: z.array(z.strictObject({ refundId: decimalId, units })),
});

export const partialRefundSnapshotSchema = z.object({
  capture: z.object({
    reference: z.string().min(1),
    id: decimalId,
    domain: z.enum(['test', 'live']),
    amountKobo: kobo.positive(),
  }),
  merchandiseNetKobo: kobo.positive(),
  allocations: z
    .array(
      z.object({
        itemId,
        unitNetAmountsKobo: z.array(kobo).min(1),
      })
    )
    .min(1),
});

type Manifest = z.infer<typeof partialRefundManifestSchema>;
type Snapshot = z.infer<typeof partialRefundSnapshotSchema>;
type ProviderRefund = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

function sumUnits(
  selection: Manifest['units'],
  allocations: ReadonlyMap<string, number>,
  seen: Set<string>
) {
  let amount = 0;
  for (const unit of selection) {
    const key = `${unit.itemId}:${unit.unitNumber}`;
    if (seen.has(key)) throw new Error('Duplicate unit in refund manifest');
    const value = allocations.get(key);
    if (value === undefined)
      throw new Error('Unit is absent from the saved quote');
    seen.add(key);
    amount += value;
  }
  return amount;
}

export async function checkBankOfferPartialRefund(
  snapshotInput: unknown,
  manifest: Manifest,
  listRefunds: (capture: Snapshot['capture']) => Promise<ProviderRefund[]>
) {
  const snapshot = partialRefundSnapshotSchema.parse(snapshotInput);
  const allocations = new Map<string, number>();
  let savedTotal = 0;
  for (const line of snapshot.allocations) {
    for (const [index, netKobo] of line.unitNetAmountsKobo.entries()) {
      const key = `${line.itemId}:${index + 1}`;
      if (allocations.has(key))
        throw new Error('Duplicate unit in saved quote');
      allocations.set(key, netKobo);
      savedTotal += netKobo;
    }
  }
  if (
    savedTotal !== snapshot.merchandiseNetKobo ||
    savedTotal > snapshot.capture.amountKobo
  ) {
    throw new Error('Saved allocations do not reconcile');
  }

  const seen = new Set<string>();
  const suggestedRefundKobo = sumUnits(manifest.units, allocations, seen);
  const previousAmounts = new Map<string, number>();
  for (const prior of manifest.previousRefunds) {
    if (previousAmounts.has(prior.refundId))
      throw new Error('Duplicate prior refund ID');
    previousAmounts.set(
      prior.refundId,
      sumUnits(prior.units, allocations, seen)
    );
  }

  // Every nonfailed refund reserves balance, including pending and needs-attention.
  let remainingPaystackKobo = snapshot.capture.amountKobo;
  const providerIds = new Set<string>();
  const activeRefunds = new Map<string, number>();
  for (const refund of await listRefunds(snapshot.capture)) {
    if (providerIds.has(refund.id) || refund.currency.toUpperCase() !== 'NGN') {
      throw new Error('Unverified Paystack refund history');
    }
    providerIds.add(refund.id);
    if (refund.status === 'failed') continue;
    activeRefunds.set(refund.id, refund.amount);
    remainingPaystackKobo -= refund.amount;
    if (remainingPaystackKobo < 0)
      throw new Error('Paystack refund history exceeds the verified capture');
  }
  if (suggestedRefundKobo > remainingPaystackKobo) {
    throw new Error('Proposed amount exceeds remaining Paystack balance');
  }
  if (
    previousAmounts.size !== activeRefunds.size ||
    [...activeRefunds].some(
      ([id, amount]) => previousAmounts.get(id) !== amount
    )
  ) {
    throw new Error(
      'Reconcile prior Paystack refunds to saved units before continuing'
    );
  }

  return {
    suggestedRefundKobo,
    remainingPaystackKobo,
    returnedUnitCount: manifest.units.length,
  };
}
