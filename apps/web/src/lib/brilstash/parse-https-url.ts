export function parseBrilStashHttpsUrl(value: string): URL | null {
  if (!/^https:\/\//i.test(value) || /[\s\\\p{Cc}]/u.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.protocol === 'https:'
      ? url
      : null;
  } catch {
    return null;
  }
}

export function parseBrilStashStorefrontOrigin(value: string): string | null {
  const url = parseBrilStashHttpsUrl(value);
  if (
    !url ||
    url.port ||
    (value !== url.origin && value !== `${url.origin}:443`)
  ) {
    return null;
  }
  return url.origin;
}

// Keep the manifest's exact URL for output. This key only collapses equivalent
// HTTPS authorities and the implicit root path. Keep in sync with the SQL key.
export function brilStashImageUrlKey(value: string): string | null {
  if (/[^!-~]|[#\\]/.test(value)) return null;
  const parts =
    /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.?)(?::([0-9]{1,5}))?([/?].*)?$/i.exec(
      value
    );
  const host = parts?.[1]?.replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  const port = Number(parts?.[2] ?? 443);
  if (port < 1 || port > 65535) return null;
  const suffix = parts?.[3] ?? '';
  const authority = `${host.toLowerCase()}${port === 443 ? '' : `:${port}`}`;
  const pathAndQuery = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `https://${authority}${pathAndQuery}`;
}
