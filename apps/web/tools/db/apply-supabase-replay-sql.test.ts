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

  it('preserves the bounded lost-connection diagnostic', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=42,reason=connection-lost)'
      );
    });
    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 1,
        sqlPath: '/owned/replay/secret.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 1: non-zero-exit \(line=42,reason=connection-lost\)$/
    );
  });

  it('preserves only the bounded synthetic checkout phase on disconnect', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        'psql failed: non-zero-exit (line=141,reason=connection-lost,phase=5)'
      );
    });
    await expect(
      applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: 1,
        sqlPath: '/owned/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 1: non-zero-exit \(line=141,reason=connection-lost,phase=5\)$/
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
