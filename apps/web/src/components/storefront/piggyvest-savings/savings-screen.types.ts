import type { z } from 'zod';
import type { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import type { CancellationBinding } from './cancellation-binding';
import type { DeviceChangeBinding } from './device-change-binding';
import type { DraftClosureBinding } from './draft-closure-binding';
import type { PolicyPanel } from './policy-panel';
import type { ProtectedOfferBinding } from './protected-offer-binding';
import type { PurchaseBinding } from './purchase-binding';
import type { ScheduleBinding } from './schedule-binding';

export type SavingsScreenSource = z.infer<typeof piggyvestSavingsScreenSchema>;

export type SavingsScreenProps = {
  /** Untrusted serializable DTO; validated before rendering. No runtime binder is installed by the wallet entry. */
  source: unknown;
  /** Optional client-only binding. The server wallet entry never forwards callbacks. */
  submitPolicy?: Parameters<typeof PolicyPanel>[0]['submit'];
  cancellation?: CancellationBinding | null;
  purchaseBinding?: PurchaseBinding | null;
  protectedOfferBinding?: ProtectedOfferBinding | null;
  purchaseSelection?: unknown;
  deviceChangeBinding?: DeviceChangeBinding | null;
  deviceChangeSelection?: unknown;
  draftClosureBinding?: DraftClosureBinding | null;
  scheduleBinding?: ScheduleBinding | null;
};
