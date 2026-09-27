export const CACHE_UNSAFE_ENCODED_DOUBLE_QUOTE_REGEX = /%e2%80%(?:9c|9d|b3)/gi;

export const CACHE_UNSAFE_ENCODED_SINGLE_QUOTE_REGEX = /%e2%80%(?:98|99|b2)/gi;

export const CACHE_UNSAFE_ENCODED_SPACE_OR_DASH_REGEX =
  /(?:%c2%a0|%e2%80%(?:90|91|92|93|94|95))/gi;

export const PROTOCOL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:/i;

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeLeadingPrefix(
  pathname: string,
  prefix: string
): string | null {
  const lowerPathname = pathname.toLowerCase();

  if (lowerPathname === prefix) {
    return pathname === prefix ? null : prefix;
  }

  if (lowerPathname.startsWith(`${prefix}/`)) {
    return pathname.startsWith(prefix)
      ? null
      : `${prefix}${pathname.slice(prefix.length)}`;
  }

  return null;
}

export function isHexDigit(char: string | undefined): boolean {
  return Boolean(char && /^[0-9A-Fa-f]$/.test(char));
}

export function lowercaseStorefrontPathname(pathname: string): string {
  let normalized = '';

  for (let index = 0; index < pathname.length; index += 1) {
    const currentChar = pathname[index];
    const nextChar = pathname[index + 1];
    const nextNextChar = pathname[index + 2];

    if (
      currentChar === '%' &&
      isHexDigit(nextChar) &&
      isHexDigit(nextNextChar)
    ) {
      normalized += pathname.slice(index, index + 3);
      index += 2;
      continue;
    }

    normalized += currentChar.toLowerCase();
  }

  return normalized;
}

export function normalizeCacheSafeStorefrontPathname(
  pathname: string
): string | null {
  // Next remote cache currently serializes the request URL through ByteString
  // constrained headers. Keep this targeted to imported punctuation and apply
  // it on the raw URL path so existing escapes like %2F are preserved.
  const punctuationNormalizedPathname = pathname
    .split('/')
    .map((segment) =>
      segment
        .replace(CACHE_UNSAFE_ENCODED_DOUBLE_QUOTE_REGEX, '')
        .replace(CACHE_UNSAFE_ENCODED_SINGLE_QUOTE_REGEX, '')
        .replace(CACHE_UNSAFE_ENCODED_SPACE_OR_DASH_REGEX, '-')
        .replace(/[\u201c\u201d\u2033]/g, '')
        .replace(/[\u2018\u2019\u2032]/g, '')
        .replace(/[\u00a0\u2010-\u2015]/g, '-')
    )
    .join('/');

  if (punctuationNormalizedPathname === pathname) {
    return null;
  }

  const normalizedPathname = punctuationNormalizedPathname
    .split('/')
    .map((segment) => segment.replace(/-+/g, '-'))
    .join('/');

  return normalizedPathname || '/';
}

export function getNoTrailingSlashRedirectPath(
  pathname: string
): string | null {
  if (pathname === '/' || !pathname.endsWith('/')) {
    return null;
  }

  const pathnameWithoutTrailingSlash = pathname.slice(0, -1);
  if (pathnameWithoutTrailingSlash.startsWith('/.well-known/')) {
    return null;
  }

  return pathnameWithoutTrailingSlash;
}
