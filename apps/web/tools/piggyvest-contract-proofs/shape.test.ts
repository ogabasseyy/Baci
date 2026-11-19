import { describe, expect, it } from 'vitest';
import { Redactor } from './redactor';
import { SENSITIVE } from './sensitive-fixtures.test-support';
import { describeFormat, fieldNames, flattenShape } from './shape';

const kitchenSink = {
  customer_id: SENSITIVE.uuid,
  wallet_id: SENSITIVE.ulid,
  email: SENSITIVE.email,
  phone: SENSITIVE.phoneIntl,
  bvn: SENSITIVE.bvn,
  account_number: SENSITIVE.nuban,
  account_name: SENSITIVE.accountName,
  name: SENSITIVE.personName,
  balance: 123456789,
  available_balance: 5000,
  withdrawal_count: 2,
  rate: 0.5,
  status: 'successful',
  type: 'credit',
  currency: 'NGN',
  new_customer: false,
  created_at: '2026-10-30T10:00:00.000Z',
  reference: SENSITIVE.reference,
  note: SENSITIVE.testKey,
  deleted_at: null,
  [SENSITIVE.uuid]: { nested: SENSITIVE.email },
  edges: [
    { id: SENSITIVE.uuid, amount: 100, status: 'pending', extra: 'a' },
    { id: SENSITIVE.ulid, amount: 200, status: 'successful' },
  ],
};

describe('flattenShape', () => {
  const entries = flattenShape(kitchenSink);
  const text = JSON.stringify(entries);

  it('never carries a sensitive value, including inside object keys', () => {
    for (const value of Object.values(SENSITIVE)) {
      expect(text).not.toContain(value);
    }
    expect(new Redactor().leaks(text)).toEqual([]);
  });

  it('never carries balances or counts as values', () => {
    expect(text).not.toContain('123456789');
    expect(entries.find((e) => e.path === 'balance')).toEqual({
      path: 'balance',
      type: 'integer',
    });
    expect(entries.find((e) => e.path === 'rate')?.type).toBe('number');
  });

  it('records field names and type-level formats', () => {
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.type]));
    expect(byPath.customer_id).toBe('string(uuid)');
    expect(byPath.wallet_id).toBe('string(ulid)');
    expect(byPath.email).toBe('string(email)');
    expect(byPath.phone).toBe('string(phone)');
    expect(byPath.bvn).toBe('string(digits:11)');
    expect(byPath.created_at).toBe('string(iso-datetime)');
    expect(byPath.deleted_at).toBe('null');
    expect(byPath.name).toBe('string(text)');
  });

  it('keeps values only for allowlisted enum-like keys', () => {
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.type]));
    expect(byPath.status).toBe('string(enum:successful)');
    expect(byPath.type).toBe('string(enum:credit)');
    expect(byPath.currency).toBe('string(enum:NGN)');
    expect(byPath.new_customer).toBe('boolean(false)');
  });

  it('merges array items and unions their types', () => {
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.type]));
    expect(byPath['edges[]']).toBe('array(len=2)');
    expect(byPath['edges[].id']).toBe('string(ulid)|string(uuid)');
    expect(byPath['edges[].status']).toBe(
      'string(enum:pending)|string(enum:successful)'
    );
    expect(byPath['edges[].extra']).toBe('string(text)');
  });

  it('replaces id-like object keys instead of recording them', () => {
    expect(entries.some((e) => e.path.startsWith('<id-key>'))).toBe(true);
  });

  it('bounds depth and entry count', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 30; i += 1) deep = { child: deep };
    expect(flattenShape(deep).length).toBeLessThan(15);
    const wide = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`field_${i}`, i])
    );
    const flat = flattenShape(wide);
    expect(flat.length).toBeLessThanOrEqual(121);
    expect(flat.at(-1)?.path).toBe('…truncated');
  });
});

describe('describeFormat / fieldNames', () => {
  it('classifies strings without exposing them', () => {
    expect(describeFormat('')).toBe('empty');
    expect(describeFormat('hello world')).toBe('text');
    expect(describeFormat('12345')).toBe('digits:5');
  });

  it('lists field names of an object, empty for non-objects', () => {
    expect(fieldNames({ a: 1, b: 2 })).toEqual(['a', 'b']);
    expect(fieldNames('x')).toEqual([]);
    expect(fieldNames(null)).toEqual([]);
  });
});
