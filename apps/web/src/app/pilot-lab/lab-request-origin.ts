// Lab-only request-origin policy, extracted from the route loader so the
// route boundary stays within the repo line ceiling.
const LAB_LOOPBACK_ORIGIN = 'http://localhost:3000';

// Request origin for the card path's absolute staged URLs (the original
// card renderer rejects relative URLs, so the lockup's relative form is
// not an option here). Host/proto headers are untrusted input and must
// never be reflected: an attacker-controlled Host would otherwise be
// embedded in rendered image URLs (cache-poisoning/phishing input on any
// shared deployment with the lab flag on). Resolution order:
// 1. BACI_IMAGE_PILOT_ORIGIN when set to a valid http(s) origin
//    (operator allowlist for staged/shared origins).
// 2. The request Host, but ONLY when it parses to loopback
//    (localhost, *.localhost, 127.0.0.1, ::1) — the lab's local runs.
// 3. The loopback default. Anything else is untrusted and ignored.
function labAssetOriginOverride(): string | null {
  const configured = (process.env.BACI_IMAGE_PILOT_ORIGIN ?? '').trim();
  if (!configured) {
    return null;
  }
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function labRequestOrigin(headers: {
  host: string | null;
  proto: string | null;
}): string {
  const override = labAssetOriginOverride();
  if (override) {
    return override;
  }
  const first = (headers.proto ?? '').split(',')[0]?.trim().toLowerCase();
  const scheme = first === 'http' || first === 'https' ? first : 'http';
  const host = (headers.host ?? '').trim();
  if (!host) {
    return LAB_LOOPBACK_ORIGIN;
  }
  try {
    const url = new URL(`${scheme}://${host}`);
    if (!isLoopbackHostname(url.hostname)) {
      return LAB_LOOPBACK_ORIGIN;
    }
    return url.origin;
  } catch {
    return LAB_LOOPBACK_ORIGIN;
  }
}
