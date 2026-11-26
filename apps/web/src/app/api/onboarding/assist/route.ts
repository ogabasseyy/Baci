import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { runGuideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding.core';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { applyRateLimit, getTrustedClientIdentifier } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { guideBusinessOnboardingInputSchema } from '@/schemas/ai-guide-business-onboarding';

export const maxDuration = 60;

const WEB_ONBOARDING_TEXT_LIMIT = {
  maxRequests: 12,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const WEB_ONBOARDING_LOGO_LIMIT = {
  maxRequests: 5,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const WEB_ONBOARDING_COLOR_LIMIT = {
  maxRequests: 10,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const WEB_ONBOARDING_IP_TEXT_LIMIT = {
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const WEB_ONBOARDING_IP_LOGO_LIMIT = {
  maxRequests: 15,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const WEB_ONBOARDING_IP_COLOR_LIMIT = {
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
  failClosedWithoutRedis: true,
};

const RASTER_DATA_URI_PATTERN = /^data:image\/(png|jpeg|webp);base64,/i;
const IMAGES_ONBOARDING_PREFIX = '/storage/v1/object/public/images/onboarding/';

function isUserScopedOnboardingLogoUrl(
  logoUrl: string,
  userId: string
): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;
  try {
    const allowedOrigin = new URL(supabaseUrl).origin;
    const candidate = new URL(logoUrl);
    if (
      candidate.origin !== allowedOrigin ||
      !candidate.pathname.startsWith(IMAGES_ONBOARDING_PREFIX)
    ) {
      return false;
    }
    const relativePath = candidate.pathname.slice(
      IMAGES_ONBOARDING_PREFIX.length
    );
    const [ownerId, ...rest] = relativePath.split('/').filter(Boolean);
    return ownerId === userId && rest.length > 0;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Authentication required.', code: 'unauthorized' },
      { status: 401 }
    );
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json(
        { error: 'CSRF validation failed', code: 'csrf_failed' },
        { status: 403 }
      )
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

  const task = parsed.data.task;

  if (task === 'generate_names' && !parsed.data.description?.trim()) {
    return NextResponse.json(
      {
        error: 'Please describe what your store sells so I can suggest names.',
        code: 'invalid_input',
      },
      { status: 400 }
    );
  }

  if (
    task === 'extract_colors' &&
    (!parsed.data.logoUrl ||
      !isUserScopedOnboardingLogoUrl(parsed.data.logoUrl, user.id))
  ) {
    return NextResponse.json(
      {
        error: 'Logo URL must be a valid uploaded onboarding logo.',
        code: 'invalid_logo_url',
      },
      { status: 400 }
    );
  }

  // Check IP bucket BEFORE per-user bucket so a shared-IP throttle does not
  // burn the caller's personal quota.
  const clientIp = getTrustedClientIdentifier(request);
  if (clientIp) {
    const ipBucket =
      task === 'generate_logos'
        ? {
            endpoint: '/api/onboarding/assist:logos:ip',
            config: WEB_ONBOARDING_IP_LOGO_LIMIT,
          }
        : task === 'extract_colors'
          ? {
              endpoint: '/api/onboarding/assist:colors:ip',
              config: WEB_ONBOARDING_IP_COLOR_LIMIT,
            }
          : {
              endpoint: '/api/onboarding/assist:ip',
              config: WEB_ONBOARDING_IP_TEXT_LIMIT,
            };
    const ipRateLimit = await applyRateLimit(
      `ip:${clientIp}`,
      ipBucket.endpoint,
      ipBucket.config
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

  const userBucket =
    task === 'generate_logos'
      ? {
          endpoint: '/api/onboarding/assist:logos',
          config: WEB_ONBOARDING_LOGO_LIMIT,
        }
      : task === 'extract_colors'
        ? {
            endpoint: '/api/onboarding/assist:colors',
            config: WEB_ONBOARDING_COLOR_LIMIT,
          }
        : {
            endpoint: '/api/onboarding/assist',
            config: WEB_ONBOARDING_TEXT_LIMIT,
          };
  const userRateLimit = await applyRateLimit(
    `user:${user.id}`,
    userBucket.endpoint,
    userBucket.config
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

  try {
    const result = await runGuideBusinessOnboarding(parsed.data, {
      allowPaidOpenAi: true,
    });
    if (task === 'generate_logos' && result.logos) {
      const rasterLogos = result.logos.filter((uri) =>
        RASTER_DATA_URI_PATTERN.test(uri.trim())
      );
      return NextResponse.json(
        { ...result, logos: rasterLogos },
        { status: 200 }
      );
    }
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
      message: 'Web onboarding assist request failed',
      task,
      userId: user.id,
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
