// Leaf module (zero imports): the claim-slug predicate is shared by the
// sender schema and the URL builder, and schemas cannot import through
// receipt-claim-links (it reaches the env credential authority). The slug
// becomes a claim-URL subdomain label, so it must be a single host-safe
// label within the 63-octet DNS label limit; case-insensitive because
// DNS resolves the wire host that way, so rejecting uppercase slugs
// would fail merchants whose links work.
export function isSafeClaimSlug(slug: string): boolean {
  return (
    slug.length >= 1 &&
    slug.length <= 63 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(slug)
  );
}
