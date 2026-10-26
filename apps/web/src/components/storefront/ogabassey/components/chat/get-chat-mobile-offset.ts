/** Shared by the deferred launcher and the loaded chat runtime. */
export function getChatMobileOffset(pathname: string | null) {
  if (
    pathname?.match(/\/[^/]+\/[^/]+\/[^/]+/) &&
    !pathname.includes('/checkout')
  ) {
    return 'product';
  }
  if (pathname?.includes('/cart')) return 'cart';
  return 'default';
}
