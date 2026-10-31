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

  it('rejects duplicate versions', () => {
    expect(parse([valid, { ...valid, secret: 'other' }]).success).toBe(false);
  });

  it('caps the archive at 8 entries per family, with a clear message', () => {
    const family = (name: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...valid,
        family: name,
        version: `${name}-${index}`,
      }));

    expect(parse(family('bank', 8)).success).toBe(true);
    const tooMany = parse(family('bank', 9));
    expect(tooMany.success).toBe(false);
    expect(JSON.stringify(tooMany.error?.issues)).toContain(
      'at most 8 archived keys per family'
    );
    // Every family gets its own budget: 4 families x 8 is the full archive.
    const everyFamily = ['legacy', 'bank', 'custody', 'interest'].flatMap(
      (name) => family(name, 8)
    );
    expect(parse(everyFamily).success).toBe(true);
    expect(
      parse([
        ...everyFamily,
        ...family('legacy', 1).map((entry) => ({ ...entry, version: 'extra' })),
      ]).success
    ).toBe(false);
  });

  it('rejects a non-array archive', () => {
    expect(parse({ ...valid }).success).toBe(false);
    expect(parse(null).success).toBe(false);
  });
});
