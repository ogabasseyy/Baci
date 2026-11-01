const STOREFRONT_ORIGIN = 'https://ogabassey.com';

export function normalizeHref(href: string): string | null {
  try {
    const url = new URL(href, STOREFRONT_ORIGIN);
    if (
      !href.trim() ||
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

function collectHrefs(value: unknown, hrefs: Set<string>) {
  if (typeof value === 'string') {
    const href = normalizeHref(value);
    if (href !== null) hrefs.add(href);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHrefs(item, hrefs);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.href === 'string') collectHrefs(value.href, hrefs);
  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === 'object' && nestedValue !== null) {
      collectHrefs(nestedValue, hrefs);
    }
  }
}

export function collectModuleHrefs(value: unknown) {
  const hrefs = new Set<string>();
  collectHrefs(value, hrefs);
  return hrefs;
}

