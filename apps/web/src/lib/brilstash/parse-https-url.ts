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
