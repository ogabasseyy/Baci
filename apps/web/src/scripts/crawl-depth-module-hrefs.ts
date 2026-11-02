const STOREFRONT_ORIGIN = 'https://ogabassey.com';

export function normalizeHref(href: string): string | null {
  try {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('?')) return null;
    const url = new URL(href, STOREFRONT_ORIGIN);
    if (
      url.origin !== STOREFRONT_ORIGIN ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function collectModuleHrefs(value: unknown) {
  const hrefs = new Set<string>();
  const visited = new WeakMap<object, number>();
  const pending: Array<{ value: unknown; allowStrings: boolean }> = [
    { value, allowStrings: true },
  ];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const { value: item, allowStrings } = current;
    if (typeof item === 'string') {
      if (allowStrings) {
        const href = normalizeHref(item);
        if (href !== null) hrefs.add(href);
      }
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const flag = allowStrings ? 2 : 1;
    const seen = visited.get(item) ?? 0;
    if (seen & flag) continue;
    visited.set(item, seen | flag);
    if (Array.isArray(item)) {
      for (const child of item) pending.push({ value: child, allowStrings });
      continue;
    }
    if (!isRecord(item)) continue;
    if (typeof item.href === 'string') {
      pending.push({ value: item.href, allowStrings: true });
    }
    for (const [key, child] of Object.entries(item)) {
      if (typeof child === 'object' && child !== null) {
        pending.push({ value: child, allowStrings: key === 'hrefs' && Array.isArray(child) });
      }
    }
  }
  return hrefs;
}

