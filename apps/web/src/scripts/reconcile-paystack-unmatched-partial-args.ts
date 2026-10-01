import {
  reconcilePaystackUnmatchedPartialArgsSchema,
} from '@/schemas/reconcile-paystack-unmatched-partial';

export type ParsedReconcilePaystackUnmatchedPartialArgs = {
  reviewId: string;
  canonicalOrderId: string;
  merchantId: string;
  operatorUserId: string;
  paystackReference: string;
  allowEmailMismatch: boolean;
};

export function parseReconcilePaystackUnmatchedPartialArgs(
  argv: readonly string[]
):
  | { ok: true; args: ParsedReconcilePaystackUnmatchedPartialArgs }
  | { ok: false; error: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!(key && key.startsWith('--')) || value === undefined) {
      return { ok: false, error: `malformed flag near ${key ?? '<end>'}` };
    }
    if (values.has(key)) {
      return { ok: false, error: `duplicate flag: ${key}` };
    }
    values.set(key, value);
  }

  const parsed = reconcilePaystackUnmatchedPartialArgsSchema.safeParse(
    Object.fromEntries(values)
  );
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${String(issue.path[0] ?? '<unknown>')}: ${issue.message}`
        : 'invalid arguments',
    };
  }

  return {
    ok: true,
    args: {
      reviewId: parsed.data['--review-id'],
      canonicalOrderId: parsed.data['--canonical-order-id'],
      merchantId: parsed.data['--merchant-id'],
      operatorUserId: parsed.data['--operator-user-id'],
      paystackReference: parsed.data['--paystack-reference'],
      allowEmailMismatch: parsed.data['--allow-email-mismatch'] === 'true',
    },
  };
}
