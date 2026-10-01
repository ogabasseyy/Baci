import { describe, expect, it } from 'vitest';
import { settingsResponse } from './settings-test-fixture';

describe('settingsResponse', () => {
  it('models configured secret presence without exposing secret values', () => {
    expect(settingsResponse.secretStatus).toEqual({
      facebook_capi_token: true,
      ga4_api_secret: true,
      snapchat_capi_token: true,
      tiktok_access_token: true,
    });
    expect(Object.keys(settingsResponse)).not.toContain('ga4_api_secret');
    expect(Object.keys(settingsResponse)).not.toContain('facebook_capi_token');
  });
});
