export const UCP_PROFILE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
export const UCP_PROFILE_VERSION = '2026-04-08';

export const CHECKOUT_SESSION_CAPABILITIES = [
  'checkout.session.create',
  'checkout.session.read',
  'checkout.session.update',
  'checkout.session.complete',
  'checkout.session.cancel',
] as const;
