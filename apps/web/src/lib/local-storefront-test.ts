export function isLocalStorefrontTest(): boolean {
  if (typeof window !== 'undefined') return false;
  return process.env.LOCAL_STOREFRONT === '1';
}
