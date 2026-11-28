'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { revalidateMerchantFeed } from '@/lib/cache-revalidation';
import { triggerDomainEdgeConfigSync } from '@/lib/edge-config-sync';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { ensurePermission } from '@/lib/merchant-server';
import { createClient } from '@/lib/supabase/server';

type SetPrimaryDomainResult =
  | { success: true }
  | { success: false; error: string };

export async function setPrimaryDomain(
  domain: string
): Promise<SetPrimaryDomainResult> {
  try {
    // Input validation
    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return { success: false, error: 'Invalid domain provided' };
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { merchant } = await ensurePermission('settings', 'edit');

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchant.id,
      'custom_domain'
    );
    if (featureGateResponse) {
      const body = (await featureGateResponse.json().catch(() => null)) as {
        error?: string;
      } | null;
      return {
        success: false,
        error: body?.error ?? 'Failed to verify merchant plan',
      };
    }

    // Verify domain belongs to merchant and verify it is active
    const { data: domainRecord, error: domainError } = await supabase
      .from('domains')
      .select('id, status')
      .eq('domain', domain)
      .eq('merchant_id', merchant.id)
      .single();

    if (domainError || !domainRecord) {
      throw new Error('Domain not found or access denied');
    }

    if (domainRecord.status !== 'active') {
      throw new Error('Only active domains can be set as primary');
    }

    // Atomically swap primary domain through the guarded lifecycle RPC
    // (works for both SaaS-bound and legacy/purchased domains).
    const { error: updateError } = await supabase.rpc(
      'set_merchant_primary_domain',
      { p_domain: domain.trim().toLowerCase() }
    );

    if (updateError) {
      throw new Error('Failed to set primary domain');
    }

    // Revalidate the domains page and feed URLs to reflect the new primary domain.
    revalidatePath('/dashboard/domains');
    revalidateMerchantFeed(merchant.id);
    void triggerDomainEdgeConfigSync();

    return { success: true };
  } catch (error: unknown) {
    console.error('Error setting primary domain:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update domain',
    };
  }
}
