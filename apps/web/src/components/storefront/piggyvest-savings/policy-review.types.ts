import type { z } from 'zod';
import type { piggyvestPolicyReviewSchemas } from '@/schemas/piggyvest-policy-review';

export type PolicyReviewProps = {
  sessionKey: string | null;
  view:
    | z.infer<typeof piggyvestPolicyReviewSchemas.view>
    | { status: 'loading' };
  onAccept: (
    acceptance: z.infer<typeof piggyvestPolicyReviewSchemas.acceptance>
  ) => Promise<void>;
};
