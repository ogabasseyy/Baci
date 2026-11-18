import { z } from 'zod';

const scopeSchema = z
  .object({
    storageKey: z.string().min(1).max(200),
    userId: z.uuid(),
    merchantId: z.uuid(),
    orderId: z.uuid(),
  })
  .strict();
export const oxygenIntentSchema = z
  .object({
    scope: scopeSchema,
    workflowId: z.uuid().nullable(),
    action: z.enum([
      'create',
      'refresh_eligibility',
      'refresh_kyc',
      'resend_customer_otp',
      'validate_nin',
      'selfie_link',
      'refresh_payment_setup',
      'cancel_booking',
      'refresh_details',
      'trigger_approval_otp',
      'start_application',
      'validate_customer',
      'book',
      'submit_address',
      'approve_booking',
    ]),
    version: z.number().int().nonnegative(),
    key: z.uuid(),
    time: z.number().int().nonnegative(),
    terms: z
      .object({
        equityPercentage: z.number().min(25).max(90),
        tenure: z.number().int().min(1).max(12),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OxygenIntent = z.infer<typeof oxygenIntentSchema>;
export type OxygenJournalScope = OxygenIntent['scope'];
export interface OxygenJournalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
function sameScope(a: OxygenJournalScope, b: OxygenJournalScope) {
  return (
    a.storageKey === b.storageKey &&
    a.userId === b.userId &&
    a.merchantId === b.merchantId &&
    a.orderId === b.orderId
  );
}
export class OxygenIntentJournal {
  private readonly key: string;
  constructor(
    private readonly storage: OxygenJournalStorage,
    readonly scope: OxygenJournalScope
  ) {
    scopeSchema.parse(scope);
    this.key = `${scope.storageKey}:oxygen-intent:${scope.userId}:${scope.merchantId}:${scope.orderId}`;
  }
  async read(): Promise<OxygenIntent | null> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const intent = oxygenIntentSchema.parse(JSON.parse(raw));
      return sameScope(intent.scope, this.scope) ? intent : null;
    } catch {
      return null;
    }
  }
  async write(intent: OxygenIntent): Promise<void> {
    const parsed = oxygenIntentSchema.parse(intent);
    if (!sameScope(parsed.scope, this.scope))
      throw new Error('Invalid Oxygen journal scope');
    await this.storage.setItem(this.key, JSON.stringify(parsed));
  }
  async clear(): Promise<void> {
    await this.storage.removeItem(this.key);
  }
}
