import { expect, it, vi } from 'vitest';
import { subscribeSocialMarketingConsent } from './subscribe-social-marketing-consent';

it('notifies for consent and storage changes only until unsubscribed', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSocialMarketingConsent(listener);
  window.dispatchEvent(new Event('cookie-consent-updated'));
  window.dispatchEvent(new Event('storage'));
  unsubscribe();
  window.dispatchEvent(new Event('cookie-consent-updated'));
  expect(listener).toHaveBeenCalledTimes(2);
});
