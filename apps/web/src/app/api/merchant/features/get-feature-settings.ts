import type { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { redactMerchantFeatureSettingsResponse } from '@/lib/merchant-feature-settings-redaction';
import { attachIntegrationSecretPresence } from './attach-integration-secret-presence';
import { jsonNoStore } from './feature-settings-response';
import {
  buildReadOnlyDefaultFeatureSettings,
  merchantFeatureSelectFields,
} from './merchant-feature-settings-contract';
import { resolveFeatureSettingsAccess } from './resolve-feature-settings-access';

export async function getFeatureSettings(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return jsonNoStore(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const requestedMerchantId = request.nextUrl.searchParams.has('merchantId')
      ? request.nextUrl.searchParams.get('merchantId')
      : undefined;
    const { access, error: accessError } = await resolveFeatureSettingsAccess({
      permission: 'read',
      requestedMerchantId,
      supabase: auth.supabase,
      userId: auth.user.id,
    });
    if (accessError || !access) {
      return jsonNoStore(
        { error: accessError?.message || 'Merchant not found' },
        { status: accessError?.status || 404 }
      );
    }

    const { data: settings, error } = await auth.supabase
      .from('merchant_feature_settings')
      .select(merchantFeatureSelectFields.join(', '))
      .eq('merchant_id', access.merchantId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching feature settings:', error);
      return jsonNoStore(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }

    const withPresence = await attachIntegrationSecretPresence(
      auth.supabase,
      access.merchantId,
      settings ?? buildReadOnlyDefaultFeatureSettings(access.merchantId)
    );
    if (!withPresence) {
      return jsonNoStore(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }
    return jsonNoStore(redactMerchantFeatureSettingsResponse(withPresence));
  } catch (error) {
    console.error('Feature settings GET error:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
