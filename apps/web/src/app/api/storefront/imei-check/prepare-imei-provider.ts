import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { validatePetrockProductSnapshot } from '@/lib/imei-providers/petrock/petrock-preflight';
import { createPetrockProvider } from '@/lib/imei-providers/petrock/petrock-provider';
import { createImeiProviderRegistry } from '@/lib/imei-providers/registry';
import { createSickwProvider } from '@/lib/imei-providers/sickw-provider';
import { resolveImeiProviderBinding } from '@/lib/imei-providers/tier-bindings';
import { errorBody, json } from './route-helpers';

interface ImeiProviderConfiguration {
  getImeiDisabledTierKeys(): readonly string[];
  getImeiIdentifierEncryptionKey(): string | undefined;
  getPetrockConfig(): { baseUrl: string; token: string } | null;
  getPetrockEnabledTierKeys(): readonly string[];
  getSickwApiKey(): string | undefined;
  isPetrockEnabled(): boolean;
}

export async function prepareImeiProvider({
  access,
  requestedTier,
  deviceCategory,
  clientSupportsAsync,
  configuration,
}: {
  access: ImeiAccessClient;
  requestedTier: ImeiServiceTierKey;
  deviceCategory?: ImeiDeviceCategory;
  clientSupportsAsync: boolean;
  configuration: ImeiProviderConfiguration;
}) {
  const {
    getImeiDisabledTierKeys,
    getImeiIdentifierEncryptionKey,
    getPetrockConfig,
    getPetrockEnabledTierKeys,
    getSickwApiKey,
    isPetrockEnabled,
  } = configuration;
  if (getImeiDisabledTierKeys().includes(requestedTier)) {
    return {
      response: json(
        errorBody({
          code: 'IMEI_TIER_DISABLED',
          error: 'Selected IMEI service tier is temporarily unavailable',
        }),
        503
      ),
    };
  }

  const serviceTier = IMEI_SERVICE_TIERS[requestedTier];
  const binding = resolveImeiProviderBinding({
    clientSupportsAsync,
    deviceCategory,
    petrockEnabled: isPetrockEnabled(),
    petrockEnabledTiers: new Set(
      getPetrockEnabledTierKeys() as ImeiServiceTierKey[]
    ),
    tier: serviceTier,
    tierKey: requestedTier,
  });
  if (!binding) {
    return {
      response: json(
        errorBody({
          code: 'IMEI_TIER_NOT_CONFIGURED',
          error: 'Selected IMEI service tier is not available.',
        }),
        503
      ),
    };
  }
  const sickwApiKey = getSickwApiKey();
  const sickwProvider = createSickwProvider({ apiKey: sickwApiKey });
  let petrockProvider: ReturnType<typeof createPetrockProvider> | undefined;
  let encryptionKey: string | undefined;

  if (binding.provider === 'petrock') {
    const petrockConfig = getPetrockConfig();
    encryptionKey = getImeiIdentifierEncryptionKey();
    if (!petrockConfig || !encryptionKey) {
      console.error('[IMEI Check] Petrock configuration is incomplete');
      return {
        response: json(
          errorBody({
            code: 'PETROCK_CONFIG_MISSING',
            error: 'IMEI lookup is temporarily unavailable',
          }),
          503
        ),
      };
    }

    const { data: snapshot, error: snapshotError } = await access.readSnapshot(
      binding.productId
    );
    if (snapshotError) throw snapshotError;
    const preflight = validatePetrockProductSnapshot({
      binding,
      now: new Date(),
      snapshot,
    });
    if (!preflight.ok) {
      console.error('[IMEI Check] Petrock preflight failed', {
        code: preflight.code,
        productId: binding.productId,
        tier: requestedTier,
      });
      return {
        response: json(
          errorBody({ code: preflight.code, error: preflight.error }),
          503
        ),
      };
    }
    petrockProvider = createPetrockProvider({
      client: createPetrockClient(petrockConfig),
    });
  } else if (!sickwProvider.isConfigured()) {
    console.error('[IMEI Check] SICKW_API_KEY is not configured');
    return {
      response: json(
        errorBody({
          code: 'SICKW_API_KEY_MISSING',
          error: 'IMEI lookup is temporarily unavailable',
        }),
        503
      ),
    };
  }

  const provider = createImeiProviderRegistry({
    petrock: petrockProvider,
    sickw: sickwProvider,
  }).get(binding.provider);
  if (!provider) {
    return {
      response: json(
        errorBody({
          code: 'IMEI_PROVIDER_UNAVAILABLE',
          error: 'IMEI lookup is temporarily unavailable',
        }),
        503
      ),
    };
  }
  return { binding, encryptionKey, provider, serviceTier };
}
