import { expect, it } from 'vitest';
import { supportsCheckoutSocialSignIn } from './checkout-social-support';

it('enables checkout social sign-in only on verified production hosts', () => {
  expect(supportsCheckoutSocialSignIn('ogabassey.com', true)).toBe(true);
  expect(supportsCheckoutSocialSignIn('www.ogabassey.com', true)).toBe(false);
  expect(supportsCheckoutSocialSignIn('ogabassey.usebaci.com', true)).toBe(false);
  expect(supportsCheckoutSocialSignIn('other.example', true)).toBe(false);
  expect(supportsCheckoutSocialSignIn('localhost', true)).toBe(false);
  expect(supportsCheckoutSocialSignIn('localhost', false)).toBe(true);
});
