import { hostedDraftEnvironmentSchema } from '@/schemas/hosted-draft-environment';
import { hostedFirstCardEnvironmentSchema } from '@/schemas/hosted-first-card-environment';
import { hostedFundingEnvironmentSchema } from '@/schemas/hosted-funding-environment';

export function readHostedSavingsEnvironment(
  environment: Readonly<Record<string, string | undefined>>
) {
  const profile = environment.BACI_WORKER_PROFILE;
  if (
    profile !== 'hosted-savings-drafts' &&
    profile !== 'hosted-savings-funding' &&
    profile !== 'hosted-first-card-checkout'
  )
    return null;
  if (
    profile !== 'hosted-first-card-checkout' &&
    (environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED !== undefined ||
      environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG !== undefined)
  )
    throw new Error('Invalid isolated savings staging environment');
  const schema =
    profile === 'hosted-first-card-checkout'
      ? hostedFirstCardEnvironmentSchema
      : profile === 'hosted-savings-funding'
        ? hostedFundingEnvironmentSchema
        : hostedDraftEnvironmentSchema;
  const staging = schema.safeParse(environment);
  if (!staging.success)
    throw new Error('Invalid isolated savings staging environment');
  return staging.data;
}
