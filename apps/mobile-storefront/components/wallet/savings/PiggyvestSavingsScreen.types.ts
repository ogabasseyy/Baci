import type {
  piggyvestPolicyReviewSchemas,
  SavingsScreenSource,
} from '@baci/shared/contracts';
import type { z } from 'zod';
import type { PiggyvestCancellationBindingInput } from './PiggyvestCancellationBinding';
import type {
  PiggyvestDeviceChangeBindingInput,
  PiggyvestDeviceChangeSelection,
} from './PiggyvestDeviceChangeBinding';
import type { PiggyvestDraftClosureBindingInput } from './PiggyvestDraftClosureBinding';
import type { PiggyvestProtectedOfferBindingInput } from './PiggyvestProtectedOfferBinding';
import type {
  PiggyvestPurchaseBindingInput,
  PiggyvestPurchaseSelection,
} from './PiggyvestPurchaseBinding';
import type { PiggyvestScheduleBindingInput } from './PiggyvestScheduleBinding';

export type PiggyvestSavingsScreenInput = {
  environment: 'staging';
  sessionKey: string | null;
  goalId: string | null;
  source: SavingsScreenSource | null;
  cancellation?: PiggyvestCancellationBindingInput | null;
  purchaseBinding?: PiggyvestPurchaseBindingInput | null;
  purchaseSelection?: PiggyvestPurchaseSelection | null;
  scheduleBinding?: PiggyvestScheduleBindingInput | null;
  draftClosureBinding?: PiggyvestDraftClosureBindingInput | null;
  deviceChangeBinding?: PiggyvestDeviceChangeBindingInput | null;
  deviceChangeSelection?: PiggyvestDeviceChangeSelection | null;
  protectedOfferBinding?: PiggyvestProtectedOfferBindingInput | null;
  onAccept: (
    acceptance: z.infer<typeof piggyvestPolicyReviewSchemas.acceptance>
  ) => Promise<void>;
};
