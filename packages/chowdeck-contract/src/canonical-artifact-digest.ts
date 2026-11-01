import { createHash } from 'node:crypto';
import { parseStrictJson } from './strict-json-parser';

export type CanonicalizeOptions = {
  omitTopLevelKey?: string;
};

const CONTROL_CHARACTER = /\p{Cc}/u;
const LONE_SURROGATE = /[\ud800-\udfff]/u;

function canonicalError(): never {
  throw new Error('not canonical evidence');
}

function assertCanonicalString(value: string): void {
  if (
    value.normalize('NFC') !== value ||
    CONTROL_CHARACTER.test(value) ||
    LONE_SURROGATE.test(value)
  ) {
    canonicalError();
  }
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean')
    return JSON.stringify(value);

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) canonicalError();
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    assertCanonicalString(value);
    return JSON.stringify(value);
  }

  if (typeof value !== 'object' || value === null) canonicalError();
  if (ancestors.has(value)) canonicalError();
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (
        Reflect.ownKeys(value).length !== value.length + 1 ||
        !Array.from({ length: value.length }, (_entry, index) =>
          Object.hasOwn(value, index)
        ).every(Boolean)
      ) {
        canonicalError();
      }
      return `[${value.map((entry) => serialize(entry, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) canonicalError();
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        assertCanonicalString(key);
        return `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`;
      });
    if (Reflect.ownKeys(record).length !== entries.length) canonicalError();
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeArtifact(
  value: unknown,
  options: CanonicalizeOptions = {}
): string {
  let projected = value;
  if (options.omitTopLevelKey !== undefined) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      canonicalError();
    }
    projected = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== options.omitTopLevelKey)
    );
  }
  return serialize(projected, new Set());
}

export function digestArtifact(
  value: unknown,
  options: CanonicalizeOptions = {}
): `sha256:${string}` {
  const bytes = canonicalizeArtifact(value, options);
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

export function parseCanonicalJson(serialized: string): unknown {
  const value = parseStrictJson(serialized);
  canonicalizeArtifact(value);
  return value;
}
