const CONTENT_ADDRESSED_RELEASE_MEDIA_PATH =
  /^\/release-assets\/[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|svg|webp)$/;

/** Returns whether a media source is immutable-safe for a public release. */
export function isStablePublicMediaUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048) return false;
  return CONTENT_ADDRESSED_RELEASE_MEDIA_PATH.test(value);
}
