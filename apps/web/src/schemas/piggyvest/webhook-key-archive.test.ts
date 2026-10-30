import { describe, expect, it } from 'vitest';
import {
  piggyvestWebhookKeyArchiveSchema,
  piggyvestWebhookKeyFamilySchema,
} from './webhook-key-archive';

const valid = {
  version: 'pv-2026-09',
  family: 'legacy',
  secret: 'synthetic-archived-secret',
  retiredAt: '2026-10-29T10:00:00.000Z',
};

describe('piggyvestWebhookKeyFamilySchema', () => {
  it('accepts exactly the routing families', () => {
    for (const family of ['legacy', 'bank', 'custody', 'interest']) {
      expect(piggyvestWebhookKeyFamilySchema.safeParse(family).success).toBe(
        true
      );
    }
    for (const family of ['', 'Legacy', 'primary', 7, null]) {
      expect(piggyvestWebhookKeyFamilySchema.safeParse(family).success).toBe(
        false
      );
    }
  });
});

describe('piggyvestWebhookKeyArchiveSchema', () => {
  const parse = (value: unknown) =>
    piggyvestWebhookKeyArchiveSchema.safeParse(value);

  it('accepts an empty archive and a well-formed entry with an offset timestamp', () => {
    expect(parse([]).success).toBe(true);
    expect(parse([valid]).success).toBe(true);
    expect(
      parse([{ ...valid, retiredAt: '2026-10-29T11:00:00+01:00' }]).success
    ).toBe(true);
  });

  it.each([
    ['a version with illegal characters', { version: 'bad version!' }],
    ['a version starting with punctuation', { version: '-lead' }],
    ['a version longer than 64 characters', { version: 'v'.repeat(65) }],
    ['an empty secret', { secret: '' }],
    ['a whitespace-only secret', { secret: '   ' }],
    ['an oversized secret', { secret: 's'.repeat(1025) }],
    ['an unknown family', { family: 'other' }],
    ['a non-ISO timestamp', { retiredAt: 'yesterday' }],
    ['a date-only timestamp', { retiredAt: '2026-10-29' }],
    ['an unexpected extra field', { note: 'surprise' }],
  ])('rejects %s', (_name, override) => {
    expect(parse([{ ...valid, ...override }]).success).toBe(false);
  });

  it('rejects an entry missing a required field', () => {
    const { secret: _omitted, ...withoutSecret } = valid;
    expect(parse([withoutSecret]).success).toBe(false);
  });

  it('rejects duplicate versions and more than 24 entries', () => {
    expect(parse([valid, { ...valid, secret: 'other' }]).success).toBe(false);
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...valid,
      version: `v${index}`,
    }));
    expect(parse(many.slice(0, 24)).success).toBe(true);
    expect(parse(many).success).toBe(false);
  });

  it('rejects a non-array archive', () => {
    expect(parse({ ...valid }).success).toBe(false);
    expect(parse(null).success).toBe(false);
  });
});
