/** Shared by the deferred launcher and the loaded chat runtime. */
export function getChatMobileOffset(pathname: string | null) {
  const segments = pathname?.split('/').filter(Boolean) ?? [];
  if (segments.includes('cart')) return 'cart';
  if (
    segments.length >= 3 &&
    !segments.includes('checkout')
  ) {
    return 'product';
  }
  return 'default';
}
