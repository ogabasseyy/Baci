import { describe, expect, it, vi } from 'vitest';
import { applySupabaseReplaySql } from './apply-supabase-replay-sql';

describe('applySupabaseReplaySql', () => {
  it('applies the exact materialized SQL path', async () => {
    const apply = vi.fn(async () => undefined);

    await applySupabaseReplaySql(apply, {
      kind: 'migration',
      ordinal: 126,
      sqlPath: '/owned/replay/126-migration.sql',
    });

    expect(apply).toHaveBeenCalledWith('/owned/replay/126-migration.sql');
  });

  it.each([
    'non-zero-exit',
    'spawn-error',
    'stderr-limit',
    'stdin-limit',
    'stdout-limit',
    'timeout',
  ] as const)('preserves the allowlisted psql failure class %s', async (failure) => {
    const apply = vi.fn(async () => {
      throw new Error(`psql failed: ${failure}`);
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 1,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      new RegExp(`^Replay SQL check failed at ordinal 1: ${failure}$`)
    );
  });

  it('accepts a sanitized custom psql executable basename', async () => {
    const apply = vi.fn(async () => {
      throw new Error('psql-18.3 failed: non-zero-exit');
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 1,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(/^Replay SQL check failed at ordinal 1: non-zero-exit$/);
  });

  it('preserves bounded psql location diagnostics without source output', async () => {
    const apply = vi.fn(async () => {
      throw new Error('psql failed: non-zero-exit (line=42,sqlstate=42501)');
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 1,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 1: non-zero-exit \(line=42,sqlstate=42501\)$/
    );
  });

  it('preserves only the bounded pgTAP failure index', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=110,sqlstate=P0001,tap=34)'
      );
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 97,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 97: non-zero-exit \(line=110,sqlstate=P0001,tap=34\)$/
    );
  });

  it('drops out-of-range pgTAP indexes from replay diagnostics', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=110,sqlstate=P0001,tap=9999999)'
      );
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 97,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 97: non-zero-exit \(line=110,sqlstate=P0001\)$/
    );
  });

  it('preserves only allowlisted permission categories from replay diagnostics', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=20,sqlstate=42501,permission=relation_access_denied)'
      );
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'migration',
        ordinal: 2045,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay migration application failed at ordinal 2045: non-zero-exit \(line=20,sqlstate=42501,permission=relation_access_denied\)$/
    );
  });

  it('drops unknown permission categories from replay diagnostics', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=20,sqlstate=42501,permission=private_object_secret)'
      );
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'migration',
        ordinal: 2045,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay migration application failed at ordinal 2045: non-zero-exit \(line=20,sqlstate=42501\)$/
    );
  });

  it.each([
    [
      'migration',
      126,
      'secret database output',
      'Replay migration application failed at ordinal 126',
    ],
    [
      'sql-check',
      1,
      'psql failed: non-zero-exit secret database output',
      'Replay SQL check failed at ordinal 1',
    ],
  ] as const)('sanitizes an unknown failed %s stage', async (kind, ordinal, error, message) => {
    const apply = vi.fn(async () => {
      throw new Error(error);
    });

    await expect(
      applySupabaseReplaySql(apply, {
        kind,
        ordinal,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(new RegExp(`^${message}: unknown$`));
  });
});
