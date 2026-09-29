import { describe, expect, it } from 'vitest';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';
import { parseSnapshotArgs } from './ogabassey-hero-snapshot-args.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

describe('parseSnapshotArgs', () => {
  it('parses slug and dedupes/trims urls', () => {
    expect(
      parseSnapshotArgs([
        'node',
        'script.mjs',
        '--slug',
        'ogabassey',
        `  ${SOURCE_URL} `,
        SOURCE_URL,
      ])
    ).toEqual({ check: false, prune: false, slug: 'ogabassey', urls: [SOURCE_URL] });
  });

  it('parses the prune flag (orphan deletion is opt-in)', () => {
    expect(
      parseSnapshotArgs([
        'node',
        'script.mjs',
        '--slug',
        'ogabassey',
        '--prune',
        SOURCE_URL,
      ])
    ).toEqual({ check: false, prune: true, slug: 'ogabassey', urls: [SOURCE_URL] });
  });

  it('parses check mode with optional urls', () => {
    expect(
      parseSnapshotArgs(['node', 'script.mjs', '--slug', 'ogabassey', '--check'])
    ).toEqual({ check: true, prune: false, slug: 'ogabassey', urls: [] });
    expect(
      parseSnapshotArgs([
        'node',
        'script.mjs',
        '--slug',
        'ogabassey',
        '--check',
        SOURCE_URL,
      ])
    ).toEqual({ check: true, prune: false, slug: 'ogabassey', urls: [SOURCE_URL] });
  });

  it('rejects check combined with prune', () => {
    expect(() =>
      parseSnapshotArgs([
        'node',
        's.mjs',
        '--slug',
        'ogabassey',
        '--check',
        '--prune',
      ])
    ).toThrow(/mutually exclusive/);
  });

  it('rejects a missing or malformed slug', () => {
    expect(() => parseSnapshotArgs(['node', 's.mjs', SOURCE_URL])).toThrow(
      HeroSnapshotError
    );
    expect(() =>
      parseSnapshotArgs(['node', 's.mjs', '--slug', 'Oga_Bassey!', SOURCE_URL])
    ).toThrow(/--slug/);
  });

  it('rejects unknown flags', () => {
    expect(() =>
      parseSnapshotArgs([
        'node',
        's.mjs',
        '--slug',
        'ogabassey',
        '--quality',
        '80',
        SOURCE_URL,
      ])
    ).toThrow(/unknown flag/);
  });

  it('rejects an empty url set', () => {
    expect(() =>
      parseSnapshotArgs(['node', 's.mjs', '--slug', 'ogabassey'])
    ).toThrow(/at least one/);
  });
});
