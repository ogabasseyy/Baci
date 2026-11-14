import path from 'node:path';
import { expect, vi } from 'vitest';
import type { ReplayRuntimeDependencies } from './supabase-history-replay-runtime';
import type {
  ProductionOldCancellationProofMode,
  ReplayCommand,
  ReplaySource,
  SupabaseHistoryEffectComparisonMode,
  SupabaseHistoryReplayMode,
  VerifiedReplayManifest,
} from './supabase-history-replay-types';
import { verifySupabaseReplayBootstrapHistory } from './verify-supabase-replay-bootstrap-history';

function source(index: number): ReplaySource {
  return {
    receiptId: `base:${index}`,
    repositoryPath: `supabase/migrations/${String(index).padStart(14, '0')}_migration.sql`,
    sha256: String(index % 10).repeat(64),
  };
}

export function createSupabaseReplayRuntimeFixture() {
  const root = '/tmp/baci-repository';
  const workdir = '/tmp/baci-replay-owned';
  const databaseUrl = 'postgresql://postgres:secret@127.0.0.1:41001/postgres';
  const ports = {
    'analytics.port': 41_006,
    'api.port': 41_000,
    'db.port': 41_001,
    'db.shadow_port': 41_002,
    'edge_runtime.inspector_port': 41_005,
    'local_smtp.port': 41_004,
    'studio.port': 41_003,
  } as const;
  const commands: string[] = [];
  const copies: string[] = [];
  const removed: string[] = [];
  const replacements: string[] = [];
  const writes: Array<{ bytes: string; path: string }> = [];
  const bootstrapSources = Array.from({ length: 125 }, (_, index) =>
    source(index + 1)
  );
  const orderedSources = [...bootstrapSources, source(126), source(127)];
  const verified = {
    bootstrapSources,
    manifest: { baseSha: 'base-sha', pendingSources: [] },
    postReplaySources: [],
  } as unknown as VerifiedReplayManifest;
  let ownership: Awaited<
    ReturnType<ReplayRuntimeDependencies['createOwnership']>
  >;
  let portProbeCount = 0;

  const deps: ReplayRuntimeDependencies = {
    allocatePorts: vi
      .fn()
      .mockResolvedValueOnce(ports)
      .mockResolvedValueOnce({ ...ports, 'api.port': 42_000 }),
    assertPortsAvailable: vi.fn(() => {
      portProbeCount += 1;
      if (portProbeCount === 1) throw new Error('race');
      return Promise.resolve();
    }),
    assertResources: vi.fn(),
    atomicReplace: vi.fn((targetPath) => {
      replacements.push(targetPath);
      return Promise.resolve();
    }),
    copyBootstrapSource: vi.fn((_repositoryRoot, _workdir, item) => {
      copies.push(item.repositoryPath);
      return Promise.resolve();
    }),
    createCommand: vi.fn(
      (): ReplayCommand => (command, args, options) => {
        commands.push(`${path.basename(command)} ${args.join(' ')}`);
        if (path.basename(command) === 'psql') {
          expect(options?.env?.PGCONNECT_TIMEOUT).toBe('5');
        }
        if (command === 'supabase' && args.includes('status')) {
          return Promise.resolve({
            stderr: '',
            stdout: `DB_URL="${databaseUrl}"\n`,
          });
        }
        if (
          path.basename(command) === 'psql' &&
          args.includes('SHOW server_version_num')
        ) {
          return Promise.resolve({ stderr: '', stdout: '170006\n' });
        }
        if (
          path.basename(command) === 'psql' &&
          options?.input?.includes('supabase_migrations.schema_migrations')
        ) {
          return Promise.resolve({
            stderr: '',
            stdout: `${JSON.stringify(
              bootstrapSources.map(({ repositoryPath }) => {
                const filename = path.basename(repositoryPath, '.sql');
                return {
                  name: filename.slice(15),
                  version: filename.slice(0, 14),
                };
              })
            )}\n`,
          });
        }
        if (command === 'supabase' && args.includes('gen')) {
          return Promise.resolve({
            stderr: '',
            stdout: 'export type Database = {};\n',
          });
        }
        return Promise.resolve({ stderr: '', stdout: '' });
      }
    ),
    createOwnership: vi.fn((options) => {
      ownership = { ...options, schemaVersion: 1 };
      return Promise.resolve(ownership);
    }),
    expectedResources: vi.fn(() => ({
      containers: [],
      networks: [],
      volumes: [],
    })),
    inspectResources: vi.fn(() =>
      Promise.resolve({ containers: [], networks: [], volumes: [] })
    ),
    makeWorkdir: vi.fn(() => Promise.resolve(workdir)),
    materializeReplay: vi.fn(() => orderedSources),
    materializeSource: vi.fn((_root, _workdir, item, ordinal) =>
      Promise.resolve(
        path.join(
          workdir,
          'sql',
          `${ordinal}-${path.basename(item.repositoryPath)}`
        )
      )
    ),
    parseConfig: vi.fn(() => ({
      dbMajorVersion: 17 as const,
      imageTransformationEnabled: true,
      poolerEnabled: false,
      ports,
      projectId: 'generated',
    })),
    readEffects: vi.fn(() =>
      Promise.resolve({
        effectSha256: 'effect-sha',
        serverVersionNum: 170006 as const,
      })
    ),
    readSource: vi.fn(() => Promise.resolve(Buffer.from(''))),
    readText: vi.fn(() => Promise.resolve('generated-config')),
    removeWorkdir: vi.fn((targetPath) => {
      removed.push(targetPath);
      return Promise.resolve();
    }),
    output: vi.fn((repositoryRoot, repositoryPath) => {
      const target = path.join(repositoryRoot, repositoryPath);
      return Promise.resolve({
        create: vi.fn((bytes: string) => {
          writes.push({ bytes, path: target });
          return Promise.resolve();
        }),
        path: target,
        read: vi.fn(),
        remove: vi.fn(() => Promise.resolve()),
        replace: vi.fn(() => {
          replacements.push(target);
          return Promise.resolve();
        }),
      });
    }),
    repositoryPath: vi.fn((repositoryRoot, repositoryPath) =>
      Promise.resolve(path.join(repositoryRoot, repositoryPath))
    ),
    rewriteConfig: vi.fn((_config, options) => JSON.stringify(options)),
    stopOwnedProject: vi.fn(async ({ runCommand }) => {
      commands.push('read ownership');
      await runCommand('supabase', [
        'stop',
        '--no-backup',
        '--workdir',
        workdir,
      ]);
      return { resourceReadiness: 'verified' as const };
    }),
    verifyContract: vi.fn(() =>
      Promise.resolve({
        nodeMajor: 24 as const,
        psqlBin: '/opt/homebrew/opt/libpq/bin/psql',
        serverVersionNum: 170006 as const,
      })
    ),
    verifyBootstrapHistory: vi.fn(verifySupabaseReplayBootstrapHistory),
    verifyEffects: vi.fn(({ comparisonMode }) =>
      Promise.resolve({
        comparison: {
          changedComponents: [],
          converged: comparisonMode === 'enforce',
          mode: comparisonMode,
          productionEffectSha256: 'a'.repeat(64),
        },
        effectSha256: 'effect-sha',
        serverVersionNum: 170006 as const,
      })
    ),
    verifyManifest: vi.fn(() => Promise.resolve(verified)),
    verifyProductionOldCancellation: vi.fn(() =>
      Promise.resolve({
        productionSha256: 'b'.repeat(64),
        repairedSha256: 'c'.repeat(64),
        verified: true as const,
      })
    ),
    writeOwnership: vi.fn(),
  };
  const replayOptions = (
    mode: SupabaseHistoryReplayMode = 'chronological',
    comparisonMode: SupabaseHistoryEffectComparisonMode = 'enforce',
    productionOldCancellationProof: ProductionOldCancellationProofMode = 'skip'
  ) => ({
    comparisonMode,
    mode,
    pendingRepairState: 'materialized' as const,
    productionOldCancellationProof,
    repositoryRoot: root,
    sqlChecks: [],
  });
  return {
    commands,
    copies,
    databaseUrl,
    deps,
    removed,
    replacements,
    replayOptions,
    root,
    workdir,
    writes,
  };
}
