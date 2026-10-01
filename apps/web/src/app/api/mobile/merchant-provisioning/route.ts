import { after, type NextRequest, NextResponse } from 'next/server';
import { recordMobileOnboardingContractInvocation } from '@/lib/posthog/mobile-onboarding-contract-telemetry';
import { recordMobileSignupLifecycle } from '@/lib/posthog/mobile-signup-lifecycle-telemetry';
import { provisionCuratedHomepage } from '@/lib/storefront-defaults/provision-curated-homepage';
import { mobileMerchantProvisioningSchema } from '@/schemas/mobile-merchant-provisioning';
import { mobileSignupAttemptIdSchema } from '@/schemas/mobile-signup-attempt-id';
import { getMobileBearerUser } from './get-mobile-bearer-user';
import { loadMobileMerchantStarterFacts } from './load-mobile-merchant-starter-facts';
import {
  type MobilePlatform,
  MobileProvisioningError,
  provisionAuthenticatedMerchant,
} from './provision-authenticated-merchant';

export const maxDuration = 60;
const SAFE_POSTGRES_CODE = /^[A-Za-z0-9_]{1,16}$/;

function invalidInputResponse() {
  return NextResponse.json(
    {
      error: 'Please check the information you entered.',
      code: 'invalid_input',
    },
    { status: 400 }
  );
}

function getPlatform(request: NextRequest): MobilePlatform | null {
  const platform = request.headers.get('x-baci-platform');
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function getPostgresCode(error: unknown): string | null {
  let code: string | null = null;
  if (error instanceof MobileProvisioningError) {
    code = error.pgCode;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    code = error.code;
  }
  return code && SAFE_POSTGRES_CODE.test(code) ? code : null;
}

interface ProvisioningFailure {
  captureException: boolean;
  code: string;
  failureClass:
    | 'conflict'
    | 'database'
    | 'homepage'
    | 'identity'
    | 'validation';
  postgresCode: string | null;
  response: NextResponse;
  stage: 'facts_read' | 'homepage' | 'input' | 'rpc';
  status: number;
}

function provisioningFailureResponse(
  error: unknown,
  stageOverride?: ProvisioningFailure['stage']
): ProvisioningFailure {
  const pgCode = getPostgresCode(error);
  if (pgCode === 'PT422') {
    return {
      captureException: false,
      code: 'identity_incomplete',
      failureClass: 'identity',
      postgresCode: pgCode,
      response: NextResponse.json(
        {
          error:
            'Your authenticated account is missing required identity data.',
          code: 'identity_incomplete',
        },
        { status: 422 }
      ),
      stage: 'rpc',
      status: 422,
    };
  }
  if (pgCode === 'PT409') {
    return {
      captureException: false,
      code: 'slug_unavailable',
      failureClass: 'conflict',
      postgresCode: pgCode,
      response: NextResponse.json(
        {
          error: 'That store URL is unavailable. Please choose another.',
          code: 'slug_unavailable',
        },
        { status: 409 }
      ),
      stage: 'rpc',
      status: 409,
    };
  }
  if (pgCode === 'PT400') {
    return {
      captureException: false,
      code: 'invalid_input',
      failureClass: 'validation',
      postgresCode: pgCode,
      response: invalidInputResponse(),
      stage: 'rpc',
      status: 400,
    };
  }

  const stage =
    stageOverride ??
    (error instanceof Error && error.name === 'MobileMerchantStarterFactsError'
      ? 'facts_read'
      : 'rpc');
  console.error(
    'mobile-merchant-provisioning %s',
    'provisioning_failed',
    JSON.stringify({ stage, pgCode })
  );
  return {
    captureException: stage !== 'homepage',
    code: 'provisioning_failed',
    failureClass: stage === 'homepage' ? 'homepage' : 'database',
    postgresCode: pgCode,
    response: NextResponse.json(
      {
        error: 'Could not finish store setup. Please try again.',
        code: 'provisioning_failed',
      },
      { status: 500 }
    ),
    stage,
    status: 500,
  };
}

function getAttemptId(request: NextRequest): string | null {
  const parsed = mobileSignupAttemptIdSchema.safeParse(
    request.headers.get('x-baci-signup-attempt-id')
  );
  return parsed.success ? parsed.data : null;
}

// CSRF exempt: this native-only contract requires an explicit verified bearer
// credential and never falls back to browser cookies.
export async function POST(request: NextRequest) {
  const auth = await getMobileBearerUser(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'unauthorized' },
      { status: 401 }
    );
  }

  const startedAt = Date.now();
  const attemptId = getAttemptId(request);
  after(() => recordMobileOnboardingContractInvocation('v2_authenticated'));

  const scheduleLifecycle = (
    input: Omit<
      Parameters<typeof recordMobileSignupLifecycle>[0],
      'attemptId' | 'durationMs'
    >
  ) => {
    after(() =>
      recordMobileSignupLifecycle({
        ...input,
        attemptId,
        durationMs: Date.now() - startedAt,
      })
    );
  };

  const platform = getPlatform(request);
  if (!platform) {
    scheduleLifecycle({
      eventCode: 'merchant_provisioning_invalid_input',
      failureClass: 'validation',
      httpStatus: 400,
      outcome: 'failed',
      platform: null,
      stage: 'input',
    });
    return invalidInputResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    scheduleLifecycle({
      eventCode: 'merchant_provisioning_invalid_input',
      failureClass: 'validation',
      httpStatus: 400,
      outcome: 'failed',
      platform,
      stage: 'input',
    });
    return invalidInputResponse();
  }

  const parsed = mobileMerchantProvisioningSchema.safeParse(body);
  if (!parsed.success) {
    scheduleLifecycle({
      eventCode: 'merchant_provisioning_invalid_input',
      failureClass: 'validation',
      httpStatus: 400,
      outcome: 'failed',
      platform,
      stage: 'input',
    });
    return invalidInputResponse();
  }

  try {
    const merchant = await provisionAuthenticatedMerchant({
      supabase: auth.supabase,
      user: auth.user,
      input: parsed.data,
      platform,
    });
    const starterFacts = await loadMobileMerchantStarterFacts({
      supabase: auth.supabase,
      merchantId: merchant.merchantId,
      ownerUserId: auth.user.id,
    });

    const homepage = await provisionCuratedHomepage({
      supabase: auth.supabase,
      expectedOwnerUserId: auth.user.id,
      ...starterFacts,
    });
    if (homepage.status === 'failed') {
      const failure = provisioningFailureResponse(
        new MobileProvisioningError(null),
        'homepage'
      );
      scheduleLifecycle({
        eventCode: 'merchant_provisioning_failed',
        failureClass: failure.failureClass,
        httpStatus: failure.status,
        outcome: 'failed',
        platform,
        postgresCode: failure.postgresCode,
        stage: failure.stage,
      });
      return failure.response;
    }

    scheduleLifecycle({
      eventCode: 'merchant_provisioning_succeeded',
      httpStatus: 200,
      outcome: 'succeeded',
      platform,
      stage: 'provisioning',
    });

    return NextResponse.json({
      success: true,
      merchant: {
        id: merchant.merchantId,
        slug: starterFacts.merchantSlug,
      },
      created: merchant.created,
    });
  } catch (error) {
    const failure = provisioningFailureResponse(error);
    scheduleLifecycle({
      captureException: failure.captureException,
      error,
      eventCode: 'merchant_provisioning_failed',
      failureClass: failure.failureClass,
      httpStatus: failure.status,
      outcome: 'failed',
      platform,
      postgresCode: failure.postgresCode,
      stage: failure.stage,
    });
    return failure.response;
  }
}
