import { hasPrivateHost } from './has-private-host';

const UNSAFE_KEY =
  /authorization|token|secret|password|apikey|email|headers?|body|rawsource|sourcedigest|environment/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const CREDENTIAL = /(?:bearer\s+|sk[_-]|api[_-]?key\s*[:=])[^\s]{8,}/i;
const SUPABASE_REFERENCE = /\b[a-z0-9]{20}\.supabase\.co\b/i;
const RESERVED_IDENTIFIER =
  /^(?:authorization|token|secret|password|api_?key|email|headers?|body|raw_source_digest|environment)$/i;

function scan(value: unknown): void {
  if (typeof value === 'string') {
    if (
      EMAIL.test(value) ||
      CREDENTIAL.test(value) ||
      SUPABASE_REFERENCE.test(value) ||
      RESERVED_IDENTIFIER.test(value) ||
      hasPrivateHost(value)
    ) {
      throw new Error('Invalid evidence manifest');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) scan(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key.replaceAll(/[_-]/g, ''))) {
      throw new Error('Invalid evidence manifest');
    }
    scan(entry);
  }
}

export function assertSafeEvidenceOutput(value: unknown): void {
  scan(value);
}
