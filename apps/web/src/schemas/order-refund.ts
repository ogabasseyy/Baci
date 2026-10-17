import { z } from 'zod';

// Exact decimal-place count off the shortest round-trip text: a
// float epsilon on value*100 breaks past ~1e8 (the product's ULP
// exceeds 1e-6), while the repr preserves the JSON author's
// intended decimals at any magnitude. Exponent forms expand to
// their true places, so whole-naira magnitudes stay valid.
function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!m) return false;
  const fracLen = m[2]?.length ?? 0;
  const exp = m[3] === undefined ? 0 : Number.parseInt(m[3], 10);
  return fracLen - exp <= 2;
}

export const orderRefundSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }).strict(),
  z
    .object({
      action: z.literal('manual'),
      amount: z
        .number()
        .finite()
        .positive()
        .refine(hasAtMostTwoDecimalPlaces, 'Use at most two decimal places'),
      refundedAt: z.iso
        .datetime({ offset: true })
        .refine(
          (value) => Date.parse(value) <= Date.now(),
          'Refund date cannot be in the future'
        ),
      method: z.enum(['paystack', 'bank_transfer', 'cash', 'other']),
      reference: z.string().trim().min(1).max(100),
      note: z.string().trim().max(500).optional(),
      confirmed: z.literal(true),
      // Optional leg pin: a Paystack attestation verifies against one
      // capture's listing, so multi-leg orders must name the refunded
      // leg instead of letting FIFO allocation guess it. Ownership
      // and fit are validated inside the RPC.
      paymentTransactionId: z.string().uuid().optional(),
    })
    .strict(),
]);
