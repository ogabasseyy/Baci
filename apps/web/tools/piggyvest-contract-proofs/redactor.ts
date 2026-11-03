import { containsRecordingAccount, HarnessRefusal } from './safety-guards';

/**
 * Evidence must contain no ids, account numbers, names, emails, phones,
 * BVNs, keys or balances of people. Two layers enforce that:
 *
 *  1. Construction: shapes never carry string values (shape.ts) and
 *     free text goes through `text()` / `message()`.
 *  2. Verification: the final document is scanned with `assertClean()`,
 *     which fails closed. A leak refuses the write, it is never "fixed up".
 *
 * Pseudonyms (W1, W2, ...) are stable within one run only. The mapping
 * from real values lives in a private field and is never serialised.
 */

export type PseudonymKind = 'W' | 'C' | 'R' | 'T' | 'Q' | 'A' | 'B' | 'N';

const MIN_REGISTERED_LENGTH = 4;
const MAX_MESSAGE_LENGTH = 160;

interface PatternRule {
  label: string;
  regex: RegExp;
  mask: string;
}

const PATTERNS: readonly PatternRule[] = [
  {
    label: 'harness-reference',
    regex: /\bpvbproof-[A-Za-z0-9_-]+/g,
    mask: '<ref>',
  },
  {
    label: 'bearer-token',
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    mask: '<token>',
  },
  {
    label: 'api-key',
    regex: /\b(?:test|live)_key_[A-Za-z0-9_-]+/gi,
    mask: '<key>',
  },
  {
    label: 'email',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    mask: '<email>',
  },
  {
    label: 'uuid',
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    mask: '<id>',
  },
  { label: 'ulid', regex: /\b[0-9A-HJKMNP-TV-Z]{26}\b/g, mask: '<id>' },
  { label: 'long-hex', regex: /\b[0-9a-f]{32,}\b/gi, mask: '<hex>' },
  { label: 'phone', regex: /\+\d[\d ()-]{8,}\d/g, mask: '<phone>' },
  { label: 'digit-run', regex: /\b\d{9,}\b/g, mask: '<number>' },
];

export class Redactor {
  readonly #byValue = new Map<string, string>();
  readonly #counters = new Map<PseudonymKind, number>();

  register(
    kind: PseudonymKind,
    value: string | null | undefined
  ): string | null {
    if (typeof value !== 'string' || value.length < MIN_REGISTERED_LENGTH) {
      return null;
    }
    const existing = this.#byValue.get(value);
    if (existing) return existing;
    const next = (this.#counters.get(kind) ?? 0) + 1;
    this.#counters.set(kind, next);
    const pseudonym = `${kind}${next}`;
    this.#byValue.set(value, pseudonym);
    return pseudonym;
  }

  pseudonym(value: string): string | null {
    return this.#byValue.get(value) ?? null;
  }

  /** Replaces registered values (longest first), then masks known patterns. */
  text(input: string): string {
    let output = input;
    const known = [...this.#byValue.entries()].sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [value, pseudonym] of known) {
      output = output.split(value).join(pseudonym);
    }
    for (const rule of PATTERNS) output = output.replace(rule.regex, rule.mask);
    return output;
  }

  /** For provider-originated messages: also masks every number of 3+ digits. */
  message(input: string): string {
    const masked = this.text(input)
      .replace(/\d{3,}/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
    return masked.length > MAX_MESSAGE_LENGTH
      ? `${masked.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
      : masked;
  }

  /** Labels (never values) describing what would leak if `output` were written. */
  leaks(output: string): string[] {
    const found = new Set<string>();
    for (const rule of PATTERNS) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(output)) found.add(rule.label);
      rule.regex.lastIndex = 0;
    }
    for (const value of this.#byValue.keys()) {
      if (output.includes(value)) found.add('registered-value');
    }
    if (containsRecordingAccount(output))
      found.add('protected-account-reference');
    return [...found];
  }

  assertClean(output: string): void {
    const labels = this.leaks(output);
    if (labels.length > 0) {
      throw new HarnessRefusal(
        'EVIDENCE_LEAK',
        `evidence not written; would leak: ${labels.join(', ')}`
      );
    }
  }

  toJSON(): Record<string, never> {
    return {};
  }

  toString(): string {
    return '[Redactor]';
  }
}
