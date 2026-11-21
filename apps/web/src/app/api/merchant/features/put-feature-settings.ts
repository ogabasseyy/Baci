import type { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  INTEGRATION_SECRET_FIELDS,
  omitBlankIntegrationSecrets,
} from '@/lib/integration-secret-settings';
import {
  getMerchantFeatureAccess,
  merchantFeatureUpgradeResponse,
} from '@/lib/merchant-feature-gates';
import {
  preserveZohoCampaignSecretCustomSettings,
  redactMerchantFeatureSettingsResponse,
} from '@/lib/merchant-feature-settings-redaction';
import { extractZohoCampaignSecrets } from '@/lib/zoho-campaign-secret-settings';
import { merchantFeatureSettingsPatchSchema } from '@/schemas/merchant-features';
import { attachIntegrationSecretPresence } from './attach-integration-secret-presence';
import type { MerchantFeatureCacheRevalidator } from './feature-settings-handler-utils';
import { hasNonEmptyGrowthIntegrationSetting } from './feature-settings-handler-utils';
import { jsonNoStore, withNoStore } from './feature-settings-response';
import {
  defaultMerchantFeatureSettings,
  merchantFeatureSelectFields,
} from './merchant-feature-settings-contract';
import { parseMerchantFeatureSettingsPatchBody } from './parse-feature-settings-patch-body';
import { resolveFeatureSettingsAccess } from './resolve-feature-settings-access';
import { saveZohoRefreshToken } from './save-zoho-refresh-token';

export function createPutFeatureSettings(
  revalidateMerchantFeatureCaches: MerchantFeatureCacheRevalidator
) {
  return async function putFeatureSettings(request: NextRequest) {
    try {
      const auth = await authenticateApiRequest(request);
      if (auth.error || !auth.user || !auth.supabase)
        return jsonNoStore(
          { error: auth.error || 'Unauthorized' },
          { status: 401 }
        );
      const { valid, response } = await checkCsrfProtection(request);
      if (!valid)
        return (
          (response ? withNoStore(response) : null) ??
          jsonNoStore({ error: 'CSRF validation failed' }, { status: 403 })
        );
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonNoStore({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const requestBody = parseMerchantFeatureSettingsPatchBody(body);
      if (!requestBody)
        return jsonNoStore({ error: 'Invalid input' }, { status: 400 });
      const { featureUpdates: newSettings, requestedMerchantId } = requestBody;
      const { access, error: accessError } = await resolveFeatureSettingsAccess(
        {
          permission: 'edit',
          requestedMerchantId,
          supabase: auth.supabase,
          userId: auth.user.id,
        }
      );
      if (accessError || !access)
        return jsonNoStore(
          { error: accessError?.message || 'Merchant not found' },
          { status: accessError?.status || 404 }
        );
      const parsedSettings =
        merchantFeatureSettingsPatchSchema.safeParse(newSettings);
      if (!parsedSettings.success)
        return jsonNoStore(
          {
            error: 'Invalid input',
            details: parsedSettings.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      const sanitizedSettings = omitBlankIntegrationSecrets(
        parsedSettings.data
      );
      if (hasNonEmptyGrowthIntegrationSetting(sanitizedSettings)) {
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
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
      sanitizedSettings.custom_settings =
        preserveZohoCampaignSecretCustomSettings(
          sanitizedSettings.custom_settings,
          existingSettings?.custom_settings
        );
      const extractedZoho = extractZohoCampaignSecrets(
        sanitizedSettings.custom_settings
      );
      sanitizedSettings.custom_settings = extractedZoho.customSettings;
      const zohoSave = await saveZohoRefreshToken(
        auth.supabase,
        access.merchantId,
        extractedZoho.refreshToken
      );
      if (!zohoSave.ok) {
        return jsonNoStore(
          { error: 'Failed to save settings' },
          { status: zohoSave.status }
        );
      }
      const completeSettings = {
        ...defaultMerchantFeatureSettings,
        ...sanitizedSettings,
        merchant_id: access.merchantId,
        updated_at: new Date().toISOString(),
      };
      completeSettings.rewards_page_enabled = completeSettings.loyalty_enabled;
      // The session cannot read the stored secrets (audit R2), so a replace must
      // not write them back, and an upsert that mentions a secret column fails
      // (ON CONFLICT DO UPDATE reads EXCLUDED.<col>, which needs SELECT on it).
      // Secrets therefore never travel in the upsert: omitting one keeps the
      // stored value, and a value (or null) is written by a plain UPDATE below.
      const secretUpdates: Record<string, unknown> = {};
      for (const key of INTEGRATION_SECRET_FIELDS) {
        if (key in sanitizedSettings)
          secretUpdates[key] = sanitizedSettings[key];
        delete completeSettings[key];
      }
      const { data: settings, error } = await auth.supabase
        .from('merchant_feature_settings')
        .upsert(completeSettings, { onConflict: 'merchant_id' })
        .select(merchantFeatureSelectFields.join(', '))
        .single();
      if (error) {
        console.error('Error replacing feature settings:', error);
        return jsonNoStore(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
      if (Object.keys(secretUpdates).length > 0) {
        const { error: secretError } = await auth.supabase
          .from('merchant_feature_settings')
          .update(secretUpdates)
          .eq('merchant_id', access.merchantId);
        if (secretError) {
          console.error('Error saving integration secrets:', secretError);
          return jsonNoStore(
            { error: 'Failed to save settings' },
            { status: 500 }
          );
        }
      }
      revalidateMerchantFeatureCaches(access.merchantId, sanitizedSettings);
      const withPresence = await attachIntegrationSecretPresence(
        auth.supabase,
        access.merchantId,
        settings
      );
      if (!withPresence) {
        return jsonNoStore(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
      return jsonNoStore(redactMerchantFeatureSettingsResponse(withPresence));
    } catch (error) {
      console.error('Feature settings PUT error:', error);
      return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
