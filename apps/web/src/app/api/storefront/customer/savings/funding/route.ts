import { type NextRequest, NextResponse } from 'next/server';
import {
  getCustomerSavingsFeatureSettings,
  getSavingsIdentifierParams,
  resolveCustomerSavingsContext,
} from '@/app/api/storefront/customer/savings/shared';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensurePiggyvestPlanFunding } from '@/lib/piggyvest/customer-plan-funding-ensure';
import { readPiggyvestPlanFundingRuntime } from '@/lib/piggyvest/customer-plan-funding-runtime';
import { retrievePiggyvestStagingFundingAccounts } from '@/lib/piggyvest/funding-accounts';
import { createPiggyvestPostgresExecutor } from '@/lib/piggyvest/postgres-executor';
import { readScopedPiggyvestWalletMapping } from '@/lib/piggyvest/scoped-wallet-mapping-reader';
import { projectPiggyvestStagingProviderConfiguration } from '@/lib/piggyvest/staging-provider-configuration';
import { piggyvestProvisioningConfigurationSchema } from '@/schemas/piggyvest-provisioning-configuration';
import {
  piggyvestSavingsPlanFundingQuerySchema,
  piggyvestSavingsPlanFundingRequestSchema,
  piggyvestSavingsPlanFundingResponseSchema,
} from '@/schemas/piggyvest-savings-plan-funding';
import { requireActiveSavingsGoal } from './require-active-savings-goal';

function unavailable() {
  return NextResponse.json(
    { status: 'unavailable', code: 'NOT_CONFIGURED' },
    { status: 503 }
  );
}

function providerUnavailable() {
  return NextResponse.json(
    { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' },
    { status: 503 }
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const parsedQuery = piggyvestSavingsPlanFundingQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const resolved = await resolveCustomerSavingsContext({
      identifiers: {
        merchantId: parsedQuery.data.merchantId,
        merchantSlug: parsedQuery.data.merchantSlug,
      },
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) return resolved.response;

    const featureSettings = await getCustomerSavingsFeatureSettings({
      customerId: resolved.customer.id,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (!featureSettings.savingsEnabled) {
      return NextResponse.json(
        {
          code: 'CUSTOMER_SAVINGS_DISABLED',
          error: 'Customer savings is not enabled for this merchant',
        },
        { status: 403 }
      );
    }

    const goalResponse = await requireActiveSavingsGoal({
      customerId: resolved.customer.id,
      goalId: parsedQuery.data.goalId,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (goalResponse) return goalResponse;

    const runtime = readPiggyvestPlanFundingRuntime();
    if (!runtime) return unavailable();
    const configuration = piggyvestProvisioningConfigurationSchema.safeParse(
      runtime.configuration
    );
    if (
      !configuration.success ||
      !configuration.data.allowlistedCustomerIds.includes(resolved.customer.id)
    ) {
      return unavailable();
    }
    let execute: ReturnType<typeof createPiggyvestPostgresExecutor>;
    try {
      execute = createPiggyvestPostgresExecutor(runtime.postgresConfiguration);
    } catch {
      return unavailable();
    }
    const mapping = await readScopedPiggyvestWalletMapping({
      configuration: {
        environment: configuration.data.environment,
        expectedMerchantId: configuration.data.expectedMerchantId,
        integrationId: configuration.data.integrationId,
      },
      scope: {
        merchantId: resolved.merchant.id,
        customerId: resolved.customer.id,
        goalId: parsedQuery.data.goalId,
      },
      execute,
    });
    if (!mapping) {
      return NextResponse.json(
        { status: 'pending', code: 'MAPPING_PENDING' },
        { status: 202 }
      );
    }

    const funding = await retrievePiggyvestStagingFundingAccounts({
      configuration: projectPiggyvestStagingProviderConfiguration(
        configuration.data
      ),
      resolveTrustedIdentity: async () => ({
        environment: 'staging' as const,
        integrationId: configuration.data.integrationId,
        merchantId: resolved.merchant.id,
        customerId: resolved.customer.id,
        goalId: parsedQuery.data.goalId,
        providerWalletId: mapping.providerWalletId,
        providerCustomerId: mapping.providerCustomerId,
      }),
      execute,
      fetchImplementation: fetch,
    });
    if (funding.status === 'pending') {
      return NextResponse.json(
        { status: 'pending', code: 'PROVISIONING_IN_PROGRESS' },
        { status: 202 }
      );
    }
    return NextResponse.json({
      status: 'ready',
      accounts: funding.accounts.map((account) => ({
        accountNumber: account.account_number,
        accountName: account.account_name,
        bankName: account.bank_name,
      })),
    });
  } catch {
    return providerUnavailable();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: 'MALFORMED_JSON', error: 'Malformed JSON' },
        { status: 400 }
      );
    }
    const parsed = piggyvestSavingsPlanFundingRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const resolved = await resolveCustomerSavingsContext({
      identifiers: getSavingsIdentifierParams(
        new URL(request.url).searchParams
      ),
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) {
      return resolved.response;
    }

    const featureSettings = await getCustomerSavingsFeatureSettings({
      customerId: resolved.customer.id,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (!featureSettings.savingsEnabled) {
      return NextResponse.json(
        {
          code: 'CUSTOMER_SAVINGS_DISABLED',
          error: 'Customer savings is not enabled for this merchant',
        },
        { status: 403 }
      );
    }

    const goalResponse = await requireActiveSavingsGoal({
      customerId: resolved.customer.id,
      goalId: parsed.data.goalId,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (goalResponse) return goalResponse;

    const customer = resolved.customer as {
      first_name?: unknown;
      last_name?: unknown;
      email?: unknown;
      phone?: unknown;
    };
    const name =
      `${String(customer.first_name ?? '')} ${String(customer.last_name ?? '')}`.trim();
    const email = String(customer.email ?? '').trim();
    const phone = String(customer.phone ?? '').trim();
    if (!name || !email || !phone) {
      return NextResponse.json(
        {
          status: 'unavailable',
          code: 'IDENTITY_INCOMPLETE',
        },
        { status: 422 }
      );
    }

    const runtime = readPiggyvestPlanFundingRuntime();
    if (!runtime) return unavailable();
    let execute: ReturnType<typeof createPiggyvestPostgresExecutor>;
    try {
      execute = createPiggyvestPostgresExecutor(runtime.postgresConfiguration);
    } catch {
      return unavailable();
    }

    const result = await ensurePiggyvestPlanFunding({
      configuration: runtime.configuration,
      customer: {
        merchantId: resolved.merchant.id,
        customerId: resolved.customer.id,
        goalId: parsed.data.goalId,
        bvn: parsed.data.bvn,
        name,
        email,
        phone,
      },
      options: {
        reserveVirtualAccount: parsed.data.reserveVirtualAccount,
        enableInterestAccrual: parsed.data.enableInterestAccrual,
      },
      execute,
      fetchImplementation: fetch,
    });
    const response = piggyvestSavingsPlanFundingResponseSchema.parse(result);
    return NextResponse.json(response, {
      status:
        response.status === 'ready'
          ? 200
          : response.status === 'pending'
            ? 202
            : 503,
    });
  } catch {
    return providerUnavailable();
  }
}
