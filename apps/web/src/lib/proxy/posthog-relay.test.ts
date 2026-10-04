import { describe, expect, it } from 'vitest';
import {
  isPostHogRelayPath,
  isReservedPostHogRelayPath,
  isStaticAssetOutsidePostHogRelay,
  normalizePostHogRelayPath,
} from './posthog-relay';

describe('PostHog relay routing', () => {
  it('normalizes a configured prefix and matches its descendants only', () => {
    expect(normalizePostHogRelayPath(' relay/ ')).toBe('/relay');
    expect(isPostHogRelayPath('/baci-relay/e')).toBe(true);
    expect(isPostHogRelayPath('/baci-relayish/e')).toBe(false);
  });

  it('protects platform prefixes and identifies static assets outside relay', () => {
    expect(isReservedPostHogRelayPath('/api/events')).toBe(true);
    expect(isReservedPostHogRelayPath('/products')).toBe(false);
    expect(isStaticAssetOutsidePostHogRelay('/static/logo.svg')).toBe(true);
    expect(
      isStaticAssetOutsidePostHogRelay('/baci-relay/static/relay.js')
    ).toBe(false);
  });
});
