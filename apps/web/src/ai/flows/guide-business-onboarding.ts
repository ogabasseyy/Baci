'use server';

import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import {
  type GuideBusinessOnboardingInput,
  type GuideBusinessOnboardingOutput,
  runGuideBusinessOnboarding,
} from './guide-business-onboarding.core';

// eslint-disable-next-line react-doctor/server-auth-actions -- public-by-design: pre-signup onboarding guide for anonymous prospects; Zod-validated + identity/IP rate limited
export async function guideBusinessOnboarding(
  rawInput: GuideBusinessOnboardingInput
): Promise<GuideBusinessOnboardingOutput> {
  // Pre-auth action (runs before account creation): abuse control instead of
  // a login gate, since it spends AI budget.
  const allowed = await ensureActionRateLimit('ai-onboarding', {
    requests: 10,
    windowMs: 600_000,
  });
  if (!allowed) {
    throw new Error(
      'Too many AI onboarding requests. Please try again in a few minutes.'
    );
  }

  return await runGuideBusinessOnboarding(rawInput);
}
