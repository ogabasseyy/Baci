import { after, type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { revalidateMerchantFeed } from '@/lib/cache-revalidation';
import {
  CLOUDFLARE_SAAS_CNAME_TARGET,
  readCloudflareSaasConfig,
} from '@/lib/cloudflare-saas';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  createDomainLifecycleWriter,
  type DomainBindingRow,
} from '@/lib/domain-lifecycle-writer';
import { reconcileProvisioningBinding } from '@/lib/domain-saas-orchestrator';
import { triggerDomainEdgeConfigSync } from '@/lib/edge-config-sync';
import {
  getMerchantFeatureAccess,
  merchantFeatureUpgradeResponse,
} from '@/lib/merchant-feature-gates';
import { vercel } from '@/lib/vercel';
import { createDomainSchema } from '@/schemas/domains';

const DOMAIN_COLUMNS = [
  'id',
  'domain',
  'tld',
  'domain_type',
  'status',
  'is_primary',
  'verification_token',
  'verification_token_expires_at',
  'verified_at',
  'ssl_status',
  'purchase_price',
  'renewal_price',
  'registered_at',
  'expires_at',
  'auto_renew',
  'nameservers',
  'ssl_issued_at',
  'created_at',
  'updated_at',
];

const DOMAIN_SELECT = DOMAIN_COLUMNS.join(', ');

/**
 * GET /api/domains
 * List all domains for authenticated merchant
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = auth.supabase;

    const merchantId = await getMerchantIdForApiUser(supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // Get all domains for this merchant (defense-in-depth, complements RLS)
    const { data: domains, error: domainsError } = await supabase
      .from('domains')
      .select(DOMAIN_SELECT)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (domainsError) {
      console.error('Error querying domains:', domainsError);
      return NextResponse.json(
        { error: 'Failed to fetch domains' },
        { status: 500 }
      );
    }

    return NextResponse.json({ domains });
  } catch (error) {
    console.error('Error fetching domains:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/domains
 * Add a custom domain (BYOD - Bring Your Own Domain)
 */
export async function POST(request: NextRequest) {
  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }
    const parsed = createDomainSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid domain format', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { domain: rawDomain, isPrimary } = parsed.data;
    const domain = rawDomain.toLowerCase();
    const supabase = auth.supabase;

    const merchantId = await getMerchantIdForApiUser(supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const featureAccess = await getMerchantFeatureAccess(
      supabase,
      merchantId,
      'custom_domain'
    );
    if (featureAccess.error) {
      console.error(
        'Error querying merchant feature access:',
        featureAccess.error
      );
      return NextResponse.json(
        { error: 'Failed to verify merchant plan' },
        { status: 500 }
      );
    }
    if (!featureAccess.allowed) {
      return merchantFeatureUpgradeResponse('custom_domain');
    }

    // ---------------------------------------------------------
    // CLOUDFLARE FOR SAAS MULTI-TENANT ONBOARDING (when configured)
    // ---------------------------------------------------------
    const cfConfig = readCloudflareSaasConfig();
    const writer = cfConfig ? createDomainLifecycleWriter() : null;
    if (cfConfig && writer) {
      const { data: reservation, error: reserveError } = await supabase.rpc(
        'reserve_merchant_domain_onboarding',
        {
          p_hostname: domain,
          p_is_primary: isPrimary,
        }
      );

      if (reserveError) {
        const msg = reserveError.message ?? '';
        if (
          reserveError.code === '23505' ||
          msg.includes('domain_already_registered')
        ) {
          return NextResponse.json(
            { error: 'This domain is already registered' },
            { status: 409 }
          );
        }
        if (msg.includes('domain_deletion_in_progress')) {
          return NextResponse.json(
            {
              error: 'Domain deletion is still in progress. Try again shortly.',
            },
            { status: 409 }
          );
        }
        if (msg.includes('custom_domain_entitlement_required')) {
          return merchantFeatureUpgradeResponse('custom_domain');
        }
        if (msg.includes('forbidden_settings_edit')) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        console.error('Domain reservation error:', reserveError);
        return NextResponse.json(
          { error: 'Failed to reserve domain' },
          { status: 500 }
        );
      }

      const reserved = reservation as {
        status: 'reserved' | 'resumed' | 'in_flight';
        domain_id: string;
        binding_id?: string;
        operation_id: string;
        lifecycle_state: DomainBindingRow['lifecycle_state'];
        cloudflare_create_state?: DomainBindingRow['cloudflare_create_state'];
        vercel_create_state?: DomainBindingRow['vercel_create_state'];
        verification_records?: DomainBindingRow['provider_verification_records'];
      };

      const { data: domainRow } = await supabase
        .from('domains')
        .select(DOMAIN_SELECT)
        .eq('id', reserved.domain_id)
        .eq('merchant_id', merchantId)
        .maybeSingle();

      if (reserved.status === 'in_flight') {
        return NextResponse.json(
          {
            domain: domainRow,
            lifecycleState: reserved.lifecycle_state,
            verificationRecords: reserved.verification_records ?? [
              {
                name: domain,
                purpose: 'routing',
                status: 'pending',
                type: 'CNAME',
                value: CLOUDFLARE_SAAS_CNAME_TARGET,
              },
            ],
          },
          { status: 202 }
        );
      }

      const initialBinding: DomainBindingRow = {
        id: reserved.binding_id ?? reserved.domain_id,
        domain_id: reserved.domain_id,
        merchant_id: merchantId,
        hostname: domain,
        dns_routing_provider: 'cloudflare_saas',
        cloudflare_zone_id: cfConfig.zoneId,
        cloudflare_hostname_id: null,
        requested_is_primary: isPrimary,
        lifecycle_state: reserved.lifecycle_state,
        current_operation_id: reserved.operation_id,
        in_flight_lease_until: null,
        cloudflare_create_state: reserved.cloudflare_create_state ?? 'none',
        vercel_create_state: reserved.vercel_create_state ?? 'none',
        next_reconcile_at: null,
        provider_verification_records: [],
      };

      const reconciled = await reconcileProvisioningBinding(initialBinding, {
        cfConfig,
        writer,
      });

      revalidateMerchantFeed(merchantId);

      return NextResponse.json(
        {
          domain: domainRow,
          lifecycleState: reconciled.binding.lifecycle_state,
          verificationRecords: reconciled.verificationRecords,
          verification: {
            type: 'CNAME',
            name: domain,
            value: CLOUDFLARE_SAAS_CNAME_TARGET,
            instructions: `Point ${domain} to ${CLOUDFLARE_SAAS_CNAME_TARGET} and add any required TXT records`,
          },
        },
        { status: reconciled.settled ? 201 : 202 }
      );
    }

    // Extract TLD
    let tld = `.${domain.split('.').slice(-1)[0]}`;
    if (domain.endsWith('.ng') || domain.match(/\.[a-z]+\.ng$/)) {
      const parts = domain.split('.');
      if (parts.length >= 3) {
        tld = `.${parts.slice(-2).join('.')}`;
      }
    }

    // ---------------------------------------------------------
    // VERCEL INTEGRATION
    // ---------------------------------------------------------
    let vercelResponse: Awaited<ReturnType<typeof vercel.addDomain>>;
    try {
      // Add domain to Vercel Project
      vercelResponse = await vercel.addDomain(domain);
    } catch (error: unknown) {
      console.error('Vercel Add Domain Error:', error);
      let status = 500;
      if (
        error instanceof Error &&
        'status' in error &&
        typeof (error as Record<string, unknown>).status === 'number'
      ) {
        const rawStatus = (error as Record<string, unknown>).status as number;
        if (
          Number.isFinite(rawStatus) &&
          rawStatus >= 100 &&
          rawStatus <= 599
        ) {
          status = rawStatus;
        }
      }
      const message =
        status === 409
          ? 'Domain is already in use by another account.'
          : 'Failed to add domain to Vercel.';
      return NextResponse.json({ error: message }, { status });
    }

    // Determine status based on Vercel response
    // If verification challenges exist, it is pending regardless of the 'verified' flag
    const hasChallenges =
      vercelResponse.verification && vercelResponse.verification.length > 0;
    const isVerified = vercelResponse.verified && !hasChallenges;

    const status = isVerified ? 'active' : 'pending';
    const sslStatus = isVerified ? 'active' : 'pending';

    // Find verification token if provided (e.g. for TXT record needed)
    let verificationToken = crypto.randomUUID(); // Default fallback

    if (vercelResponse.verification) {
      const txtChallenge = vercelResponse.verification.find(
        (v) => v.type === 'TXT'
      );
      if (txtChallenge) {
        verificationToken = txtChallenge.value;
      }
    }

    const verificationTokenExpiresAt = new Date(
      Date.now() + 48 * 60 * 60 * 1000
    ).toISOString();

    // Insert domain into DB
    const { data: newDomain, error: insertError } = await supabase
      .from('domains')
      .insert({
        merchant_id: merchantId,
        domain,
        tld,
        domain_type: 'custom',
        status,
        ssl_status: sslStatus,
        verification_token: verificationToken,
        verification_token_expires_at: verificationTokenExpiresAt,
        is_primary: isPrimary,
      })
      .select(DOMAIN_SELECT)
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'This domain is already registered' },
          { status: 409 }
        );
      }
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to register domain' },
        { status: 500 }
      );
    }

    // Prepare response with verification instructions
    const verificationInstructions = {
      type: 'A',
      name: '@',
      value: '76.76.21.21',
      instructions: 'Point your domain to Vercel via A Record',
    };

    // If Vercel requires a specific TXT challenge (e.g. ownership conflict), pass that
    // But mostly we prefer A-record flow.
    // However, if verification_token came from Vercel TXT, we might want to hint that.

    revalidateMerchantFeed(merchantId);
    after(() => triggerDomainEdgeConfigSync());

    return NextResponse.json({
      domain: newDomain,
      verification: verificationInstructions,
    });
  } catch (error: unknown) {
    console.error('Error adding domain:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
