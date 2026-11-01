import { expect, it, vi } from 'vitest';
import { isValidSnapchatPixelId } from './is-valid-snapchat-pixel-id';
import { isValidTikTokPixelId } from './is-valid-tiktok-pixel-id';
import { subscribeSocialMarketingConsent } from './subscribe-social-marketing-consent';

it('rejects malformed pixel identifiers', () => {
  expect(isValidTikTokPixelId('TT123')).toBe(true);
  expect(isValidTikTokPixelId("x');alert(1)//")).toBe(false);
  expect(isValidSnapchatPixelId('11111111-1111-4111-8111-111111111111')).toBe(
    true
  );
  expect(isValidSnapchatPixelId('invalid')).toBe(false);
});
it('stops notifying after consent listeners are removed', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSocialMarketingConsent(listener);
  window.dispatchEvent(new Event('cookie-consent-updated'));
  unsubscribe();
  window.dispatchEvent(new Event('cookie-consent-updated'));
  expect(listener).toHaveBeenCalledTimes(1);
});
