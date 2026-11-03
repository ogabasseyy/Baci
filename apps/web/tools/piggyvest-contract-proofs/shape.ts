import type { FlatShapeEntry } from './types';

/**
 * Type-level description of a provider payload. Field names and formats
 * are recorded; string and number VALUES are not, except for a small
 * allowlist of enum-like keys (status, type, currency, ...). Object keys
 * that look like ids are replaced.
 */

const ENUM_KEYS = new Set([
  'status',
  'type',
  'category',
  'currency',
  'wallet_type',
  'interest_type',
  'new_customer',
  'hasNextPage',
  'is_active',
]);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function describeFormat(value: string): string {
  if (value === '') return 'empty';
  if (UUID.test(value)) return 'uuid';
  if (ULID.test(value)) return 'ulid';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'iso-datetime';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/^\+\d{7,}$/.test(value)) return 'phone';
  if (/^\d+$/.test(value)) return `digits:${value.length}`;
  return 'text';
}

export function fieldNames(value: unknown): string[] {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function safeKey(key: string): string {
  if (
    UUID.test(key) ||
    ULID.test(key) ||
    /^\d{6,}$/.test(key) ||
    /@/.test(key) ||
    /^[0-9a-f]{24,}$/i.test(key)
  ) {
    return '<id-key>';
  }
  return key.length > 64 || /\s/.test(key) ? '<odd-key>' : key;
}

function leafType(key: string, value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') {
    return ENUM_KEYS.has(key) ? `boolean(${value})` : 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (typeof value === 'string') {
    const format = describeFormat(value);
    if (
      format === 'text' &&
      ENUM_KEYS.has(key) &&
      /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value)
    ) {
      return `string(enum:${value})`;
    }
    return `string(${format})`;
  }
  return typeof value;
}

export function flattenShape(value: unknown): FlatShapeEntry[] {
  const types = new Map<string, Set<string>>();
  let truncated = false;

  const add = (path: string, type: string): boolean => {
    const known = types.get(path);
    if (known) {
      known.add(type);
      return true;
    }
    if (types.size >= MAX_ENTRIES) {
      truncated = true;
      return false;
    }
    types.set(path, new Set([type]));
    return true;
  };

  const visit = (
    node: unknown,
    path: string,
    key: string,
    depth: number,
    arrayItem = false
  ) => {
    if (Array.isArray(node)) {
      const arrayPath = `${path}[]`;
      if (!add(arrayPath, `array(len=${node.length})`) || depth >= MAX_DEPTH) {
        return;
      }
      for (const item of node) {
        if (item !== null && typeof item === 'object') {
          visit(item, arrayPath, key, depth + 1, true);
        } else {
          add(`${arrayPath}.(item)`, leafType(key, item));
        }
      }
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (path !== '' && !arrayItem) add(path, 'object');
      if (depth >= MAX_DEPTH) return;
      for (const [childKey, child] of Object.entries(node)) {
        const safe = safeKey(childKey);
        const childPath = path === '' ? safe : `${path}.${safe}`;
        visit(child, childPath, childKey, depth + 1);
      }
      return;
    }
    add(path === '' ? '(root)' : path, leafType(key, node));
  };

  visit(value, '', '', 0);
  const entries = [...types.entries()].map(([path, set]) => ({
    path,
    type: [...set].sort().join('|'),
  }));
  if (truncated) entries.push({ path: '…truncated', type: 'true' });
  return entries;
}
