import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import {
  CLOUDFLARE_SAAS_CNAME_TARGET,
  extractCloudflareVerificationRecords,
  findCloudflareCustomHostnameByName,
  getCloudflareCustomHostname,
  readCloudflareSaasConfig,
} from '@/lib/cloudflare-saas';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';

/**
 * GET /api/domains/[domain]/verification
 * Refreshes current lifecycle state and DNS verification records (including
 * async Cloudflare TXT DCV records) without creating a second reservation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  try {
    const { domain } = await params;
    const normalizedDomain = domain.trim().toLowerCase();

    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = auth.supabase;
    const access = await getUserAccess(supabase);
    if (!access) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    if (!hasPermission(access, 'settings', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      access.merchantId,
      'custom_domain'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    const { data: domainRecord, error: domainError } = await supabase
      .from('domains')
      .select('id, domain, status, verification_token')
      .eq('domain', normalizedDomain)
      .eq('merchant_id', access.merchantId)
      .maybeSingle();

    if (domainError) {
      return NextResponse.json(
        { error: 'Failed to look up domain' },
        { status: 500 }
      );
    }

    if (!domainRecord) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    const { data: bindingRow } = await supabase
      .from('domain_provider_bindings')
      .select(
        'hostname, cloudflare_zone_id, cloudflare_hostname_id, lifecycle_state, provider_verification_records'
      )
      .eq('domain_id', domainRecord.id)
      .maybeSingle();

    if (!bindingRow) {
      return NextResponse.json({
        domain: domainRecord.domain,
        lifecycleState:
          domainRecord.status === 'active' ? 'active' : 'pending_verification',
        verificationRecords: [
          {
            name: '@',
            purpose: 'routing',
            status: domainRecord.status === 'active' ? 'verified' : 'pending',
            type: 'A',
            value: '76.76.21.21',
          },
        ],
      });
    }

    let verificationRecords = Array.isArray(
      bindingRow.provider_verification_records
    )
      ? bindingRow.provider_verification_records
      : [];

    const cfConfig = readCloudflareSaasConfig();
    if (cfConfig) {
      try {
        const zoneConfig = {
          ...cfConfig,
          zoneId: bindingRow.cloudflare_zone_id ?? cfConfig.zoneId,
        };
        const remote = bindingRow.cloudflare_hostname_id
          ? await getCloudflareCustomHostname(
              bindingRow.cloudflare_hostname_id,
              zoneConfig
            )
          : await findCloudflareCustomHostnameByName(
              bindingRow.hostname,
              zoneConfig
            );

        if (remote) {
          verificationRecords = extractCloudflareVerificationRecords(
            bindingRow.hostname,
            remote
          );
        }
      } catch (error) {
        console.warn('Cloudflare verification record refresh failed:', error);
      }
    }

    if (verificationRecords.length === 0) {
      verificationRecords = [
        {
          name: bindingRow.hostname,
          purpose: 'routing',
          status:
            bindingRow.lifecycle_state === 'active' ? 'verified' : 'pending',
          type: 'CNAME',
          value: CLOUDFLARE_SAAS_CNAME_TARGET,
        },
      ];
    }

    return NextResponse.json({
      domain: bindingRow.hostname,
      lifecycleState: bindingRow.lifecycle_state,
      verificationRecords,
    });
  } catch (error) {
    console.error('Error refreshing domain verification records:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
