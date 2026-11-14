// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorefrontChatwootWidgetConfig } from './storefront-widget-config';

const merchantId = '11111111-1111-4111-8111-111111111111';
const websiteToken = 'public-widget-token-123456';

afterEach(() => vi.unstubAllEnvs());

describe('storefront Chatwoot widget config', () => {
  it('stays disabled unless both the loader and context flags are enabled', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'false');
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_BINDINGS', 'invalid');

    expect(getStorefrontChatwootWidgetConfig(merchantId)).toBeNull();
  });

  it('does not mount when only the existing context feature is enabled', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'false');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId,
          origin: 'https://shop.example.com',
          websiteToken,
          inboxId: 42,
        },
      ])
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com'
    );

    expect(getStorefrontChatwootWidgetConfig(merchantId)).toBeNull();
  });

  it('returns the exact merchant binding and fixed platform origin with both flags', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId,
          origin: 'https://SHOP.example.com:443/',
          websiteToken,
          inboxId: 42,
        },
      ])
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com:443/'
    );

    expect(getStorefrontChatwootWidgetConfig(merchantId)).toEqual({
      platformOrigin: 'https://support.example.com',
      storefrontOrigin: 'https://shop.example.com',
      websiteToken,
    });
    expect(
      getStorefrontChatwootWidgetConfig('22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });

  it('fails closed when the fixed widget origin is not a clean HTTPS origin', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId,
          origin: 'https://shop.example.com',
          websiteToken,
          inboxId: 42,
        },
      ])
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com/path'
    );

    expect(getStorefrontChatwootWidgetConfig(merchantId)).toBeNull();
  });
});
