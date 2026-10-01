import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applySupabaseCurrentTreeSources } from './apply-supabase-current-tree-sources';
import { REPAIR_CASES } from './apply-supabase-current-tree-sources.repair-cases';

describe('applySupabaseCurrentTreeSources', () => {
  it('materializes verified post-replay and pending sources in suffix order', async () => {
    const materializeSource = vi.fn(
      async (
        _root: string,
        _workdir: string,
        source: { repositoryPath: string },
        ordinal: number
      ) => `/owned/sql/${ordinal}-${source.repositoryPath.split('/').at(-1)}`
    );
    const apply = vi.fn(async () => undefined);

    await applySupabaseCurrentTreeSources({
      apply,
      materializeSource,
      readSource: async () => Buffer.from(''),
      pendingSources: [
        {
          repositoryPath: 'supabase/migrations/00000000000129_pending.sql',
          sha256: '9'.repeat(64),
        },
      ],
      postReplaySources: [
        {
          receiptId: 'post-replay:supabase/migrations/00000000000128_post.sql',
          repositoryPath: 'supabase/migrations/00000000000128_post.sql',
          sha256: '8'.repeat(64),
        },
      ],
      repositoryRoot: '/repository',
      startingOrdinal: 128,
      workdir: '/owned',
    });

    expect(materializeSource.mock.calls.map((call) => call.slice(2))).toEqual([
      [
        expect.objectContaining({
          receiptId: 'post-replay:supabase/migrations/00000000000128_post.sql',
        }),
        128,
      ],
      [
        expect.objectContaining({
          receiptId: 'pending:supabase/migrations/00000000000129_pending.sql',
        }),
        129,
      ],
    ]);
    expect(apply.mock.calls).toEqual([
      ['/owned/sql/128-00000000000128_post.sql'],
      ['/owned/sql/129-00000000000129_pending.sql'],
    ]);
  });

  it('reports the exact suffix ordinal when application fails', async () => {
    const apply = vi.fn(async () => {
      throw new Error('psql failed: non-zero-exit (line=7,sqlstate=42501)');
    });

    await expect(
      applySupabaseCurrentTreeSources({
        apply,
        materializeSource: async () => '/owned/sql/129-pending.sql',
        readSource: async () => Buffer.from(''),
        pendingSources: [
          {
            repositoryPath: 'supabase/migrations/00000000000129_pending.sql',
            sha256: '9'.repeat(64),
          },
        ],
        postReplaySources: [],
        repositoryRoot: '/repository',
        startingOrdinal: 129,
        workdir: '/owned',
      })
    ).rejects.toThrow(
      /^Replay migration application failed at ordinal 129: non-zero-exit \(line=7,sqlstate=42501\)$/
    );
  });

  it.each(
    REPAIR_CASES
  )('replays the $label source through its append-only repair', async ({
    historicalPath,
    historicalSha256,
    repairPath,
    ordinal,
  }) => {
    const materializeSource = vi.fn(
      async (
        _root: string,
        _workdir: string,
        source: { repositoryPath: string },
        materializeOrdinal: number
      ) =>
        `/owned/sql/${materializeOrdinal}-${source.repositoryPath.split('/').at(-1)}`
    );
    const apply = vi.fn(async () => undefined);
    await applySupabaseCurrentTreeSources({
      apply,
      materializeSource,
      readSource: async () =>
        readFile(
          path.resolve(
            import.meta.dirname,
            '../../../../supabase/migrations',
            path.basename(historicalPath)
          )
        ),
      pendingSources: [
        { repositoryPath: historicalPath, sha256: historicalSha256 },
        { repositoryPath: repairPath, sha256: 'b'.repeat(64) },
      ],
      postReplaySources: [],
      repositoryRoot: '/repository',
      startingOrdinal: ordinal,
      workdir: '/owned',
    });

    expect(materializeSource.mock.calls.map((call) => call.slice(2))).toEqual([
      [expect.objectContaining({ repositoryPath: repairPath }), ordinal],
    ]);
    expect(apply).toHaveBeenCalledWith(
      `/owned/sql/${ordinal}-${repairPath.split('/').at(-1)}`
    );
  });

  it('applies the shipping repair before stale-quote clearing and never reapplies it', async () => {
    const shipping = REPAIR_CASES.find(
      ({ label }) => label === 'Shipping provider policy audit'
    );
    if (!shipping) throw new Error('Missing shipping repair fixture');
    const staleQuotePath =
      'supabase/migrations/20260923123000_allow_stale_shipping_quote_clear.sql';
    const apply = vi.fn(async (_sqlPath: string) => undefined);
    await applySupabaseCurrentTreeSources({
      apply,
      materializeSource: async (_root, _workdir, source) =>
        source.repositoryPath,
      readSource: async (_root, sourcePath) =>
        readFile(path.resolve(import.meta.dirname, '../../../../', sourcePath)),
      pendingSources: [
        {
          repositoryPath: shipping.historicalPath,
          sha256: shipping.historicalSha256,
        },
        { repositoryPath: staleQuotePath, sha256: 'c'.repeat(64) },
        { repositoryPath: shipping.repairPath, sha256: 'b'.repeat(64) },
      ],
      postReplaySources: [],
      repositoryRoot: '/repository',
      startingOrdinal: 129,
      workdir: '/owned',
    });
    expect(apply.mock.calls.map(([sqlPath]) => sqlPath)).toEqual([
      shipping.repairPath,
      staleQuotePath,
    ]);
  });

  it('rejects a drifted historical source before applying its repair', async () => {
    const materializeSource = vi.fn(async () => '/owned/sql/129-repair.sql');
    const apply = vi.fn(async () => undefined);

    await expect(
      applySupabaseCurrentTreeSources({
        apply,
        materializeSource,
        readSource: async () => Buffer.from('drifted historical source'),
        pendingSources: [
          {
            repositoryPath: REPAIR_CASES[0].historicalPath,
            sha256: REPAIR_CASES[0].historicalSha256,
          },
          {
            repositoryPath: REPAIR_CASES[0].repairPath,
            sha256: 'b'.repeat(64),
          },
        ],
        postReplaySources: [],
        repositoryRoot: '/repository',
        startingOrdinal: 129,
        workdir: '/owned',
      })
    ).rejects.toThrow(/^Replay source hash mismatch$/);

    expect(materializeSource).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('skips the superseded GIGL recovery repair after its successor is applied', async () => {
    const historicalPath =
      'supabase/migrations/20260801142000_harden_gigl_notification_recovery_edges.sql';
    const successorPath =
      'supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql';
    const supersededPath =
      'supabase/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql';
    const materializeSource = vi.fn(
      async (
        _root: string,
        _workdir: string,
        source: { repositoryPath: string },
        ordinal: number
      ) => `/owned/sql/${ordinal}-${source.repositoryPath.split('/').at(-1)}`
    );
    const apply = vi.fn(async () => undefined);

    await applySupabaseCurrentTreeSources({
      apply,
      materializeSource,
      readSource: async () =>
        readFile(
          path.resolve(
            import.meta.dirname,
            '../../../../supabase/migrations',
            path.basename(historicalPath)
          )
        ),
      pendingSources: [
        {
          repositoryPath: historicalPath,
          sha256:
            'b373ae3f70d7311004e7e4400c2b3a3c8534300e82ee01c2c9e0d3df2680b81e',
        },
        { repositoryPath: supersededPath, sha256: 'a'.repeat(64) },
        { repositoryPath: successorPath, sha256: 'b'.repeat(64) },
      ],
      postReplaySources: [],
      repositoryRoot: '/repository',
      startingOrdinal: 129,
      workdir: '/owned',
    });

    expect(materializeSource.mock.calls.map((call) => call.slice(2))).toEqual([
      [expect.objectContaining({ repositoryPath: successorPath }), 129],
    ]);
    expect(apply).toHaveBeenCalledWith(
      `/owned/sql/129-${successorPath.split('/').at(-1)}`
    );
  });

  it('fails closed when a superseded repair reaches replay before its successor', async () => {
    await expect(
      applySupabaseCurrentTreeSources({
        apply: async () => undefined,
        materializeSource: async () => '/owned/sql/129-superseded.sql',
        readSource: async () => Buffer.from(''),
        pendingSources: [
          {
            repositoryPath:
              'supabase/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql',
            sha256: 'a'.repeat(64),
          },
        ],
        postReplaySources: [],
        repositoryRoot: '/repository',
        startingOrdinal: 129,
        workdir: '/owned',
      })
    ).rejects.toThrow(
      'Superseded replay source requires its replacement to be applied first'
    );
  });
});
