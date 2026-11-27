import { describe, expect, it } from 'vitest';
import { chatwootSdkUrl } from './chatwoot-sdk-url';

const origin = 'https://support.example.com';

describe('chatwootSdkUrl', () => {
  it('stamps the SDK path with the UTC day', () => {
    expect(chatwootSdkUrl(origin, new Date('2026-11-27T21:30:00Z'))).toBe(
      'https://support.example.com/packs/js/sdk.js?v=2026-11-27'
    );
  });

  it('keeps one cacheable URL within a day and changes it the next day', () => {
    const morning = chatwootSdkUrl(origin, new Date('2026-11-27T00:00:00Z'));
    const night = chatwootSdkUrl(origin, new Date('2026-11-27T23:59:59Z'));
    const nextDay = chatwootSdkUrl(origin, new Date('2026-11-28T00:00:00Z'));

    expect(night).toBe(morning);
    expect(nextDay).not.toBe(morning);
  });

  it('uses the UTC day whatever offset the time is written in', () => {
    expect(
      chatwootSdkUrl(origin, new Date('2026-11-28T00:30:00+01:00'))
    ).toContain('?v=2026-11-27');
  });
});
