import {
  RECORDING_ACCOUNT_NORMALISED_MARKERS,
  SANDBOX_HOST,
  SANDBOX_ORIGIN,
} from './constants';

/**
 * Pure guard functions. Every refusal throws HarnessRefusal with a stable
 * code and a message that never contains the offending value (keys, hosts
 * and account references are never echoed).
 */

export type RefusalCode =
  | 'BASE_URL_NOT_SANDBOX'
  | 'KEY_MISSING'
  | 'KEY_NOT_TEST'
  | 'RECORDING_ACCOUNT'
  | 'MODE_CONFLICT'
  | 'USAGE'
  | 'ALLOWLIST_REQUIRED'
  | 'ALLOWLIST_INVALID'
  | 'HOST_NOT_ALLOWED'
  | 'MUTATION_IN_READONLY'
  | 'METHOD_NOT_ALLOWED'
  | 'PATH_NOT_ALLOWED'
  | 'MUTATION_WITHOUT_INTENT'
  | 'MUTATION_MISMATCH'
  | 'WALLET_NOT_AUTHORIZED'
  | 'AMOUNT_CAP'
  | 'REFERENCE_REUSE'
  | 'JOURNAL_WRITE_FAILED'
  | 'JOURNAL_CORRUPT'
  | 'JOURNAL_LOCKED'
  | 'SLOT_ALREADY_EXECUTED'
  | 'SYNTHETIC_IDENTITY_REQUIRED'
  | 'EVIDENCE_LEAK'
  | 'EVIDENCE_WRITE_FORBIDDEN';

export class HarnessRefusal extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, detail?: string) {
    super(`Refused (${code})${detail ? `: ${detail}` : ''}`);
    this.name = 'HarnessRefusal';
    this.code = code;
  }
}

function hasUnsafeUrlCharacter(text: string): boolean {
  return [...text].some(
    (character) =>
      character === '\\' ||
      /\s/.test(character) ||
      character.charCodeAt(0) <= 31
  );
}

/** Returns the canonical sandbox origin or refuses. Exact host match only. */
export function assertSandboxBaseUrl(raw: unknown): string {
  const refuse = (): never => {
    throw new HarnessRefusal(
      'BASE_URL_NOT_SANDBOX',
      `base URL host must be exactly ${SANDBOX_HOST}`
    );
  };
  if (typeof raw !== 'string') return refuse();
  const trimmed = raw.trim();
  if (trimmed.length === 0 || hasUnsafeUrlCharacter(trimmed)) {
    return refuse();
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return refuse();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== SANDBOX_HOST ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    return refuse();
  }
  // The WHATWG parser is lenient; the text itself must also be the origin.
  const lower = trimmed.toLowerCase();
  if (lower !== SANDBOX_ORIGIN && lower !== `${SANDBOX_ORIGIN}/`) {
    return refuse();
  }
  return SANDBOX_ORIGIN;
}

export type KeyClass = 'test' | 'live' | 'unknown';

/** Classifies by the prefix that precedes the secret body (`test_key_...`). */
export function classifyKey(key: string): KeyClass {
  const prefix =
    /^[A-Za-z]+(?:_[A-Za-z]+)*?_(?:key|live|test)_/i.exec(key)?.[0] ??
    key.slice(0, 12);
  const lower = prefix.toLowerCase();
  if (lower.includes('live')) return 'live';
  if (lower.includes('test')) return 'test';
  return 'unknown';
}

/**
 * Existing tooling accepts only `test_key_<alnum>` secrets for the PiggyVest
 * sandbox (see tools/piggyvest-staging/intake-config.ts). Anything else,
 * including every live-looking key, is refused.
 */
export function assertTestKey(key: string | undefined): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new HarnessRefusal('KEY_MISSING', 'no sandbox API key configured');
  }
  if (
    !/^test_key_[A-Za-z0-9_-]{1,512}$/.test(key) ||
    classifyKey(key) !== 'test'
  ) {
    throw new HarnessRefusal(
      'KEY_NOT_TEST',
      'the API key does not look like a sandbox test key'
    );
  }
}

const MAX_SCAN_NODES = 5_000;
const MAX_SCAN_DEPTH = 12;

function normalise(text: string): string {
  let current = text.normalize('NFKC');
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringMatches(text: string): boolean {
  const normalised = normalise(text);
  return RECORDING_ACCOUNT_NORMALISED_MARKERS.some((marker) =>
    normalised.includes(marker)
  );
}

/** Deep scan of strings, array items, object keys and values. */
export function containsRecordingAccount(value: unknown): boolean {
  let budget = MAX_SCAN_NODES;
  const visit = (node: unknown, depth: number): boolean => {
    budget -= 1;
    if (budget < 0 || depth > MAX_SCAN_DEPTH) return true; // fail closed
    if (typeof node === 'string') return stringMatches(node);
    if (Array.isArray(node)) return node.some((item) => visit(item, depth + 1));
    if (node !== null && typeof node === 'object') {
      return Object.entries(node).some(
        ([key, item]) => stringMatches(key) || visit(item, depth + 1)
      );
    }
    return false;
  };
  return visit(value, 0);
}

export function assertNoRecordingAccount(label: string, value: unknown): void {
  if (containsRecordingAccount(value)) {
    throw new HarnessRefusal(
      'RECORDING_ACCOUNT',
      `${label} references a protected account`
    );
  }
}

/** Outgoing customer emails must be the obviously synthetic QA range. */
export function assertSyntheticEmail(email: unknown): void {
  if (
    typeof email !== 'string' ||
    !/^synthetic\+[0-9a-f]{12}@example\.test$/.test(email)
  ) {
    throw new HarnessRefusal(
      'SYNTHETIC_IDENTITY_REQUIRED',
      'only synthetic QA identities may be sent'
    );
  }
}
