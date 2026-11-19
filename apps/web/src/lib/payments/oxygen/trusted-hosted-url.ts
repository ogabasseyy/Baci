/** Public allowlisted origins come from the server, never from the target URL. */
export function isTrustedOxygenHostedUrl(
  value: string,
  origins: readonly string[]
): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      origins.includes(url.origin)
    );
  } catch {
    return false;
  }
}
