import type { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { omitBlankIntegrationSecrets } from '@/lib/integration-secret-settings';
import {
  getMerchantFeatureAccess,
  merchantFeatureUpgradeResponse,
} from '@/lib/merchant-feature-gates';
import {
  preserveZohoCampaignSecretCustomSettings,
  redactMerchantFeatureSettingsResponse,
} from '@/lib/merchant-feature-settings-redaction';
import { merchantFeatureSettingsPatchSchema } from '@/schemas/merchant-features';
import type { MerchantFeatureCacheRevalidator } from './feature-settings-handler-utils';
import {
  hasNonEmptyGrowthIntegrationSetting,
  isUniqueViolation,
} from './feature-settings-handler-utils';
import { jsonNoStore, withNoStore } from './feature-settings-response';
import {
  defaultMerchantFeatureSettings,
  merchantFeatureSelectFields,
} from './merchant-feature-settings-contract';
import { parseMerchantFeatureSettingsPatchBody } from './parse-feature-settings-patch-body';
import { resolveFeatureSettingsAccess } from './resolve-feature-settings-access';

export function createPatchFeatureSettings(
  revalidateMerchantFeatureCaches: MerchantFeatureCacheRevalidator
) {
  return async function patchFeatureSettings(request: NextRequest) {
    try {
      const auth = await authenticateApiRequest(request);
      if (auth.error || !auth.user || !auth.supabase) {
        return jsonNoStore(
          { error: auth.error || 'Unauthorized' },
          { status: 401 }
        );
      }
      const { valid, response } = await checkCsrfProtection(request);
      if (!valid) {
        return (
          (response ? withNoStore(response) : null) ??
          jsonNoStore({ error: 'CSRF validation failed' }, { status: 403 })
        );
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonNoStore({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const patchBody = parseMerchantFeatureSettingsPatchBody(body);
      if (!patchBody)
        return jsonNoStore({ error: 'Invalid input' }, { status: 400 });

      const { featureUpdates, requestedMerchantId } = patchBody;
      const { access, error: accessError } = await resolveFeatureSettingsAccess(
        {
          permission: 'edit',
          requestedMerchantId,
          supabase: auth.supabase,
          userId: auth.user.id,
        }
      );
      if (accessError || !access) {
        return jsonNoStore(
          { error: accessError?.message || 'Merchant not found' },
          { status: accessError?.status || 404 }
        );
      }
      const parsedUpdates =
        merchantFeatureSettingsPatchSchema.safeParse(featureUpdates);
      if (!parsedUpdates.success) {
        return jsonNoStore(
          {
            error: 'Invalid input',
            details: parsedUpdates.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }
      const sanitizedUpdates = omitBlankIntegrationSecrets(parsedUpdates.data);
      if ('loyalty_enabled' in sanitizedUpdates) {
        sanitizedUpdates.rewards_page_enabled =
          sanitizedUpdates.loyalty_enabled;
      }
      if (hasNonEmptyGrowthIntegrationSetting(sanitizedUpdates)) {
        const featureAccess = await getMerchantFeatureAccess(
          auth.supabase,
          access.merchantId,
          'growth_integrations'
        );
        if (featureAccess.error) {
          console.error(
            'Error checking growth integration access:',
            featureAccess.error
          );
          return jsonNoStore(
            { error: 'Failed to verify merchant plan' },
            { status: 500 }
          );
        }
        if (!featureAccess.allowed)
          return withNoStore(
            merchantFeatureUpgradeResponse('growth_integrations')
          );
      }
      const { data: existingSettings, error: existingSettingsError } =
        await auth.supabase
          .from('merchant_feature_settings')
          .select('custom_settings')
          .eq('merchant_id', access.merchantId)
          .maybeSingle();
      if (existingSettingsError) {
        console.error(
          'Error checking existing feature settings:',
          existingSettingsError
        );
        return jsonNoStore(
          { error: 'Failed to update settings' },
          { status: 500 }
        );
      }
      if ('custom_settings' in sanitizedUpdates) {
        sanitizedUpdates.custom_settings =
          preserveZohoCampaignSecretCustomSettings(
            sanitizedUpdates.custom_settings,
            existingSettings?.custom_settings
          );
      }
      const settingsPayload = {
        ...sanitizedUpdates,
        updated_at: new Date().toISOString(),
      };
      const writeResult = existingSettings
        ? await auth.supabase
            .from('merchant_feature_settings')
            .update(settingsPayload)
            .eq('merchant_id', access.merchantId)
            .select(merchantFeatureSelectFields.join(', '))
            .single()
        : await auth.supabase
            .from('merchant_feature_settings')
            .insert({
              ...defaultMerchantFeatureSettings,
              merchant_id: access.merchantId,
              ...settingsPayload,
            })
            .select(merchantFeatureSelectFields.join(', '))
            .single();
      const { data: settings, error } =
        !existingSettings && isUniqueViolation(writeResult.error)
          ? await auth.supabase
              .from('merchant_feature_settings')
              .update(settingsPayload)
              .eq('merchant_id', access.merchantId)
              .select(merchantFeatureSelectFields.join(', '))
              .single()
          : writeResult;
      if (error) {
        console.error('Error updating feature settings:', error);
        return jsonNoStore(
          { error: 'Failed to update settings' },
          { status: 500 }
        );
      }
      revalidateMerchantFeatureCaches(access.merchantId, sanitizedUpdates);
      return jsonNoStore(redactMerchantFeatureSettingsResponse(settings));
    } catch (error) {
      console.error('Feature settings PATCH error:', error);
      return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
