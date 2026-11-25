import { type NextRequest, NextResponse } from 'next/server';
import { runGuideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding.core';
import { logger } from '@/lib/logger';
import { applyRateLimit, getTrustedClientIdentifier } from '@/lib/rate-limit';
import { guideBusinessOnboardingInputSchema } from '@/schemas/ai-guide-business-onboarding';
import { getMobileBearerUser } from '../merchant-provisioning/get-mobile-bearer-user';

export const maxDuration = 60;

const MOBILE_ONBOARDING_TEXT_LIMIT = {
  maxRequests: 12,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const MOBILE_ONBOARDING_LOGO_LIMIT = {
  maxRequests: 5,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const MOBILE_ONBOARDING_IP_TEXT_LIMIT = {
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const MOBILE_ONBOARDING_IP_LOGO_LIMIT = {
  maxRequests: 15,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

export async function POST(request: NextRequest) {
  const auth = await getMobileBearerUser(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: 'Authentication required.', code: 'unauthorized' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.', code: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = guideBusinessOnboardingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the information you entered.',
        code: 'invalid_input',
      },
      { status: 400 }
    );
  }

  const isImageTask =
    parsed.data.task === 'generate_logos' ||
    parsed.data.task === 'extract_colors';
  const userRateLimit = await applyRateLimit(
    `user:${auth.user.id}`,
    isImageTask
      ? '/api/mobile/onboarding-assist:logos'
      : '/api/mobile/onboarding-assist',
    isImageTask ? MOBILE_ONBOARDING_LOGO_LIMIT : MOBILE_ONBOARDING_TEXT_LIMIT
  );
  if (!userRateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          'Too many AI onboarding requests. Please try again in a few minutes.',
        code: 'rate_limited',
      },
      { status: 429 }
    );
  }

  const clientIp = getTrustedClientIdentifier(request);
  if (clientIp) {
    const ipRateLimit = await applyRateLimit(
      `ip:${clientIp}`,
      isImageTask
        ? '/api/mobile/onboarding-assist:logos:ip'
        : '/api/mobile/onboarding-assist:ip',
      isImageTask
        ? MOBILE_ONBOARDING_IP_LOGO_LIMIT
        : MOBILE_ONBOARDING_IP_TEXT_LIMIT
    );
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        {
          error:
            'Too many AI onboarding requests. Please try again in a few minutes.',
          code: 'rate_limited',
        },
        { status: 429 }
      );
    }
  }

  try {
    const result = await runGuideBusinessOnboarding(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Too many AI onboarding requests')) {
      return NextResponse.json(
        {
          error:
            'Too many AI onboarding requests. Please try again in a few minutes.',
          code: 'rate_limited',
        },
        { status: 429 }
      );
    }

    logger.error({
      message: 'Mobile onboarding assist request failed',
      task: parsed.data.task,
      userId: auth.user.id,
      error: message,
    });
    return NextResponse.json(
      {
        error: 'Unable to complete AI onboarding request right now.',
        code: 'ai_unavailable',
      },
      { status: 503 }
    );
  }
}
