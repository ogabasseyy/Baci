import { expect, it } from 'vitest';
import { omitBlankIntegrationSecrets } from './integration-secret-settings';

it('blank replacement preserves credentials; null explicitly disconnects; new credentials rotate', () => {
  expect(
    omitBlankIntegrationSecrets({
      facebook_capi_token: ' ',
      tiktok_access_token: '',
      snapchat_capi_token: null,
      ga4_api_secret: 'new-key',
      reviews_enabled: true,
    })
  ).toEqual({
    snapchat_capi_token: null,
    ga4_api_secret: 'new-key',
    reviews_enabled: true,
  });
});
