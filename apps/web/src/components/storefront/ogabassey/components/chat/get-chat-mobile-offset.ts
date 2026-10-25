/** Shared by the deferred launcher and the loaded chat runtime. */
export function getChatMobileOffset(pathname: string | null) {
  if (pathname?.includes('/cart')) return 'cart';
  if (
    pathname?.match(/\/[^/]+\/[^/]+\/[^/]+/) &&
    !pathname.includes('/checkout')
  ) {
    return 'product';
  }
  return 'default';
}
