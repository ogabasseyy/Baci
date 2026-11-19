import { useChatwootSupportActive } from './chatwoot-widget';

export const config = {
  platformOrigin: 'https://support.example.com',
  storefrontOrigin: 'https://shop.example.com',
  websiteToken: 'public-widget-token-123456',
  storeSlug: 'shop',
};

export function SupportStatus() {
  return (
    <output data-testid="support-active">
      {String(useChatwootSupportActive())}
    </output>
  );
}

export function resetChatwootGlobals() {
  delete (window as Window & { chatwootSDK?: unknown }).chatwootSDK;
  delete (window as Window & { $chatwoot?: unknown }).$chatwoot;
  delete (window as Window & { chatwootSettings?: Record<string, unknown> })
    .chatwootSettings;
  delete (window as Window & { __baciChatwootRunStarted?: boolean })
    .__baciChatwootRunStarted;
  delete (window as Window & { __baciChatwootConfigKey?: string })
    .__baciChatwootConfigKey;
  delete (window as Window & { __baciChatwootReadyKey?: string })
    .__baciChatwootReadyKey;
  delete (window as Window & { __baciChatwootContainedKey?: string })
    .__baciChatwootContainedKey;
  delete (window as Window & { __baciChatwootPendingContainKey?: string })
    .__baciChatwootPendingContainKey;
  document.getElementById('baci-chatwoot-sdk')?.remove();
}
