// Slug-prefixed storefront contexts (localhost, previews, the root domain)
// serve the launcher at /{slug}/checkout/bnpl; an absolute /order-success
// would escape the storefront there. Preserve whatever prefix the launcher
// itself was served under.
export function buildLauncherScopedPath(target: string) {
    if (typeof window === 'undefined') {
        return target;
    }
    const { pathname } = window.location;
    const anchorIndex = pathname.lastIndexOf('/checkout/bnpl');
    if (anchorIndex <= 0) {
        return target;
    }
    return `${pathname.slice(0, anchorIndex)}${target}`;
}
