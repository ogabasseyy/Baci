import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  DEFAULT_WEBHOOK_KEY_OVERLAP_HOURS,
  derivePiggyvestKeyVersion,
  familyArchivedSecrets,
  MAX_WEBHOOK_KEY_OVERLAP_HOURS,
  partitionArchivedKeys,
  readWebhookKeyArchive,
  readWebhookKeyOverlapMs,
  withFamilyArchivedSecrets,
} from './webhook-key-archive';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-30T12:00:00.000Z');

const entry = (version: string, retiredHoursAgo: number, secret = 'x') => ({
  version,
  family: 'legacy' as const,
  secret,
  retiredAt: new Date(NOW.getTime() - retiredHoursAgo * HOUR).toISOString(),
});

describe('readWebhookKeyOverlapMs', () => {
  it('defaults to 72 hours when unset, blank or not a plain positive integer', () => {
    const expected = DEFAULT_WEBHOOK_KEY_OVERLAP_HOURS * HOUR;
    for (const value of [undefined, '', '  ', 'abc', '0', '-5', '1.5', '12h']) {
      expect(
        readWebhookKeyOverlapMs({
          PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS: value,
        } as unknown as NodeJS.ProcessEnv)
      ).toBe(expected);
    }
  });

  it('honours a configured window and clamps it at seven days', () => {
    const read = (value: string) =>
      readWebhookKeyOverlapMs({
        PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS: value,
      } as unknown as NodeJS.ProcessEnv);
    expect(read('1')).toBe(HOUR);
    expect(read(' 24 ')).toBe(24 * HOUR);
    expect(read('168')).toBe(MAX_WEBHOOK_KEY_OVERLAP_HOURS * HOUR);
    expect(read('999999')).toBe(MAX_WEBHOOK_KEY_OVERLAP_HOURS * HOUR);
  });
});

describe('readWebhookKeyArchive', () => {
  const read = (value: string | undefined) =>
    readWebhookKeyArchive({
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: value,
    } as unknown as NodeJS.ProcessEnv);

  it('treats an unset or blank archive as empty, not as an error', () => {
    for (const value of [undefined, '', '   ']) {
      expect(read(value)).toMatchObject({ ok: true, entries: [] });
    }
  });

  it('parses a valid archive with its overlap window', () => {
    const result = read(JSON.stringify([entry('pv-1', 5)]));
    expect(result).toMatchObject({ ok: true, overlapMs: 72 * HOUR });
    expect(result.ok && result.entries[0]?.version).toBe('pv-1');
  });

  it('never silently empties an unreadable archive', () => {
    for (const value of [
      '{nope',
      '{}',
      JSON.stringify([{ version: 'v' }]),
      JSON.stringify([entry('dup', 1), entry('dup', 2)]),
      JSON.stringify(Array.from({ length: 25 }, (_, i) => entry(`v${i}`, 1))),
    ]) {
      expect(read(value)).toEqual({ ok: false });
    }
  });
});

describe('partitionArchivedKeys', () => {
  const archive = (entries: ReturnType<typeof entry>[]) =>
    ({ ok: true, entries, overlapMs: 72 * HOUR }) as const;

  it('keeps a key in the overlap strictly before the window ends', () => {
    const { overlap, replayOnly } = partitionArchivedKeys(
      archive([entry('inside', 71.99), entry('edge', 72), entry('past', 200)]),
      NOW
    );
    expect(overlap.map((key) => key.version)).toEqual(['inside']);
    expect(replayOnly.map((key) => key.version)).toEqual(['edge', 'past']);
  });

  it('tolerates clock skew but fails safe on a retirement stamp far in the future', () => {
    const { overlap, replayOnly } = partitionArchivedKeys(
      archive([entry('skewed', -0.05), entry('typo', -24 * 365)]),
      NOW
    );
    expect(overlap.map((key) => key.version)).toEqual(['skewed']);
    expect(replayOnly.map((key) => key.version)).toEqual(['typo']);
  });

  it('returns empty partitions for an empty archive', () => {
    expect(partitionArchivedKeys(archive([]), NOW)).toEqual({
      overlap: [],
      replayOnly: [],
    });
  });
});

describe('derivePiggyvestKeyVersion', () => {
  it('is stable per key, different across keys and never contains the key', () => {
    const first = randomBytes(32).toString('hex');
    const second = randomBytes(32).toString('hex');
    const version = derivePiggyvestKeyVersion(first);
    expect(version).toMatch(/^k-[0-9a-f]{16}$/);
    expect(derivePiggyvestKeyVersion(first)).toBe(version);
    expect(derivePiggyvestKeyVersion(second)).not.toBe(version);
    expect(version).not.toContain(first.slice(0, 8));
  });
});

describe('family-scoped archived secrets for the primary intakes', () => {
  const env = (entries: unknown, extra: Record<string, string> = {}) =>
    ({
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify(entries),
      ...extra,
    }) as unknown as NodeJS.ProcessEnv;
  const entries = [
    entry('bank-overlap', 1, 'bank-overlap-secret'),
    entry('bank-revoked', 200, 'bank-revoked-secret'),
    {
      ...entry('interest-overlap', 1, 'interest-overlap-secret'),
      family: 'interest',
    },
    {
      ...entry('custody-revoked', 200, 'custody-revoked-secret'),
      family: 'custody',
    },
  ].map((item) =>
    item.version.startsWith('bank') ? { ...item, family: 'bank' } : item
  );

  it('ingress scope returns only same-family keys still inside the overlap', () => {
    expect(familyArchivedSecrets('bank', env(entries), NOW, 'ingress')).toEqual(
      ['bank-overlap-secret']
    );
    expect(
      familyArchivedSecrets('interest', env(entries), NOW, 'ingress')
    ).toEqual(['interest-overlap-secret']);
    expect(
      familyArchivedSecrets('custody', env(entries), NOW, 'ingress')
    ).toEqual([]);
  });

  it('replay scope adds the same family replay-only keys, never another family', () => {
    expect(familyArchivedSecrets('bank', env(entries), NOW, 'replay')).toEqual([
      'bank-overlap-secret',
      'bank-revoked-secret',
    ]);
    expect(
      familyArchivedSecrets('custody', env(entries), NOW, 'replay')
    ).toEqual(['custody-revoked-secret']);
    expect(
      familyArchivedSecrets('legacy', env(entries), NOW, 'replay')
    ).toEqual([]);
  });

  it('contributes nothing when the archive is unset or unreadable', () => {
    expect(
      familyArchivedSecrets('bank', {} as NodeJS.ProcessEnv, NOW, 'replay')
    ).toEqual([]);
    expect(
      familyArchivedSecrets('bank', env('{broken'), NOW, 'replay')
    ).toEqual([]);
  });

  it('appends to retained keys after validation without duplicating or mutating', () => {
    const config = Object.freeze({
      webhookSecret: 'current',
      retainedWebhookSecrets: ['kept', 'bank-overlap-secret'],
      other: 1,
    });
    const merged = withFamilyArchivedSecrets(
      config,
      'bank',
      env(entries),
      NOW,
      'replay'
    );
    expect(merged).toEqual({
      webhookSecret: 'current',
      retainedWebhookSecrets: [
        'kept',
        'bank-overlap-secret',
        'bank-revoked-secret',
      ],
      other: 1,
    });
    expect(config.retainedWebhookSecrets).toEqual([
      'kept',
      'bank-overlap-secret',
    ]);
  });

  it('adds a retained list when the config had none and never replaces the current key', () => {
    const merged = withFamilyArchivedSecrets(
      { webhookSecret: 'current' } as {
        webhookSecret: string;
        retainedWebhookSecrets?: string[];
      },
      'bank',
      env(entries),
      NOW,
      'ingress'
    );
    expect(merged.webhookSecret).toBe('current');
    expect(merged.retainedWebhookSecrets).toEqual(['bank-overlap-secret']);
  });
});
