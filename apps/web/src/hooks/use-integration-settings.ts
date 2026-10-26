'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import { omitBlankIntegrationSecrets } from '@/lib/integration-secret-settings';

interface UseIntegrationSettingsOptions<T> {
  /** Keys to fetch from the merchant features API */
  keys: (keyof T)[];
  /** Platform name for toast messages */
  platformName: string;
}

interface UseIntegrationSettingsReturn<T> {
  /** Current settings values */
  settings: T | null;
  /** Whether the settings are loading */
  isLoading: boolean;
  /** Whether the merchant is available */
  hasMerchant: boolean;
  /** Save settings to the API */
  saveSettings: (updates: Partial<T>) => Promise<void>;
}

// Pick only the keys we care about from an API response object.
function extractKeys<T extends object>(
  source: Record<string, unknown>,
  keys: (keyof T)[]
): T {
  const extracted = {} as T;
  for (const key of keys) {
    extracted[key] = (source[key as string] ?? null) as T[keyof T];
  }
  return extracted;
}

// Fetch the current settings from the features API. Returns null when the
// request is not ok. Kept at module scope so the try/catch (with throws)
// doesn't trigger a React Compiler bailout in the hook body.
async function fetchIntegrationSettings<T extends object>(
  merchantId: string,
  keys: (keyof T)[]
): Promise<T | null> {
  const response = await fetch(
    `/api/merchant/features?${new URLSearchParams({ merchantId })}`
  );
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return extractKeys<T>(data, keys);
}

// Save settings to the features API and return the persisted subset.
// Throws on a non-ok response so the caller can surface an error toast.
async function persistIntegrationSettings<T extends object>(
  merchantId: string,
  updates: Partial<T>,
  keys: (keyof T)[]
): Promise<T> {
  const response = await fetchWithCsrf('/api/merchant/features', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...omitBlankIntegrationSecrets(updates),
      merchantId,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save settings');
  }

  const data = await response.json();
  return extractKeys<T>(data, keys);
}

/**
 * Shared hook for integration pages to fetch and save settings
 * from the merchant features API.
 *
 * @example
 * ```tsx
 * interface FacebookSettings {
 *   facebook_pixel_id: string | null;
 *   facebook_capi_token: string | null;
 * }
 *
 * const { settings, isLoading, saveSettings } = useIntegrationSettings<FacebookSettings>({
 *   keys: ['facebook_pixel_id', 'facebook_capi_token'],
 *   platformName: 'Facebook',
 * });
 * ```
 */
export function useIntegrationSettings<T extends object>({
  keys,
  platformName,
}: UseIntegrationSettingsOptions<T>): UseIntegrationSettingsReturn<T> {
  const { merchant } = useMerchant();
  const { toast } = useToast();
  const [settings, setSettings] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(!!merchant);
  const activeMerchantScopeRef = useRef({
    generation: 0,
    merchantId: merchant?.id ?? null,
  });

  // Adjust loading/settings during render when the merchant changes, instead of
  // re-arming the loading flag inside the fetch effect. Re-arming a loading flag
  // in an effect whose deps include the merchant object identity bails the React
  // Compiler out; deriving it here avoids the stale frame a prop-sync effect adds
  // and keeps the no-merchant reset out of the effect entirely.
  // See react.dev "Adjusting some state when a prop changes".
  const [prevMerchant, setPrevMerchant] = useState(merchant);
  if (merchant !== prevMerchant) {
    setPrevMerchant(merchant);
    setSettings(null);
    setIsLoading(!!merchant);
  }

  useLayoutEffect(() => {
    const nextMerchantId = merchant?.id ?? null;
    if (activeMerchantScopeRef.current.merchantId !== nextMerchantId) {
      activeMerchantScopeRef.current = {
        generation: activeMerchantScopeRef.current.generation + 1,
        merchantId: nextMerchantId,
      };
    }
  }, [merchant?.id]);

  // Fetch current settings from the features API once a merchant is present.
  // Loading is armed during render (above / initial state); the effect only
  // resolves it, so it never re-arms a loading flag keyed on object identities.
  useEffect(() => {
    if (!merchant) {
      return;
    }

    let active = true;

    fetchIntegrationSettings<T>(merchant.id, keys)
      .then((loaded) => {
        if (active) {
          setSettings(loaded);
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to fetch settings for', platformName, ':', error);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [merchant, keys, platformName]);

  // Save settings to the features API. Uses a promise chain (no try/catch with
  // a re-throw in the hook body) so React Compiler can lower the hook.
  const saveSettings = (updates: Partial<T>): Promise<void> => {
    const submittedMerchantId = merchant?.id ?? null;
    const submittedGeneration = activeMerchantScopeRef.current.generation;
    const isSubmittedMerchantCurrent = () =>
      activeMerchantScopeRef.current.merchantId === submittedMerchantId &&
      activeMerchantScopeRef.current.generation === submittedGeneration;
    return (
      submittedMerchantId
        ? persistIntegrationSettings<T>(submittedMerchantId, updates, keys)
        : Promise.reject<T>(new Error('Merchant unavailable'))
    )
      .then((persisted) => {
        if (!isSubmittedMerchantCurrent()) return;
        setSettings(persisted);
        toast({
          title: 'Settings saved',
          description: `Your ${platformName} settings have been updated.`,
        });
      })
      .catch((error) => {
        if (!isSubmittedMerchantCurrent()) return;
        console.error('Failed to save settings for', platformName, ':', error);
        toast({
          variant: 'destructive',
          title: 'Save failed',
          description: 'Could not save your settings. Please try again.',
        });
        return Promise.reject(error);
      });
  };

  return {
    settings,
    isLoading,
    hasMerchant: !!merchant,
    saveSettings,
  };
}
