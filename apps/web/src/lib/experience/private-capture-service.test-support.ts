import { vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPrivateExperienceCapture } from './private-capture-service';

export const merchantId = '11111111-1111-4111-8111-111111111111';
export const buildId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
export const input = { buildId, routeId: '/', idempotencyKey };
export function fixture() {
  const javascript = 'export default null;';
  const css = '';
  const buildDigest = digestBytes(`${javascript}\0${css}`);
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: javascript }],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: ['navigation'],
  };
  const rows: Record<string, unknown> = {
    experience_builds: {
      id: buildId,
      build_digest: buildDigest,
      job_id: 'job',
      host_origin: 'http://localhost:43174',
    },
    experience_jobs: { artifact_id: 'artifact', status: 'finalized' },
    experience_artifacts: { manifest },
    experience_build_files: [javascript, css].map((value, i) => ({
      path: i ? 'app.css' : 'app.js',
      bytes: `\\x${Buffer.from(value).toString('hex')}`,
      digest: digestBytes(value),
    })),
    experience_snapshots: [],
  };
  const eq = vi.fn();
  const from = vi.fn((table: string) => {
    let allowedPaths: string[] | undefined;
    let replayPrefix: string | undefined;
    const q = {
      select: () => q,
      eq: (key: string, value: string) => {
        eq(table, key, value);
        return q;
      },
      like: (_key: string, pattern: string) => {
        replayPrefix = pattern.slice(0, -1);
        return q;
      },
      in: (key: string, values: string[]) => {
        if (key !== 'path') return q;
        allowedPaths = values;
        return q;
      },
      maybeSingle: async () => ({ data: rows[table], error: null }),
      limit: async (n: number) => ({
        data: Array.isArray(rows[table])
          ? (
              rows[table] as {
                path?: string;
                snapshot_key?: { state: string };
              }[]
            )
              .filter(
                (row) =>
                  (!allowedPaths || allowedPaths.includes(row.path ?? '')) &&
                  (!replayPrefix ||
                    row.snapshot_key?.state.startsWith(replayPrefix))
              )
              .slice(0, n)
          : rows[table],
        error: null,
      }),
    };
    return q;
  });
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const getUser = vi.fn(async () => ({
    data: { user: { id: merchantId } },
    error: null,
  }));
  const ctx = { merchantId, supabase: { from, rpc, auth: { getUser } } };
  const record = vi.fn(
    (capture: {
      id: string;
      buildId: string;
      buildDigest: string;
      keyDigest: string;
      snapshot: { key: unknown };
    }) => {
      rows.experience_snapshots = [
        ...(rows.experience_snapshots as unknown[]),
        {
          id: capture.id,
          build_id: capture.buildId,
          build_digest: capture.buildDigest,
          key_digest: capture.keyDigest,
          snapshot_key: capture.snapshot.key,
        },
      ];
      return Promise.resolve();
    }
  );
  const capture = vi.fn(
    async ({
      assetsDigest,
      bootstrap,
    }: {
      assetsDigest: string;
      bootstrap?: { catalog: { revision: string } };
    }) => ({
      snapshot: {
        key: {
          build: buildDigest,
          assets: assetsDigest,
          catalog: bootstrap?.catalog.revision ?? 'revision',
          path: '/',
          viewport: '390',
          locale: 'en-NG',
          browser: 'chromium',
          extractor: 'semantic-v1',
        },
        text: 'synthetic',
      },
      evidence: { bytes: Buffer.from('synthetic-image') },
    })
  );
  const bootstrap = vi.fn(async () => ({
    catalog: { revision: 'revision' },
    route: { canonicalPath: '/' },
  }));
  const run = createPrivateExperienceCapture({
    hostOrigin: 'http://localhost:43174',
    record,
    capture: capture as never,
    bootstrap: bootstrap as never,
  });
  return {
    ctx,
    run,
    rows,
    eq,
    from,
    rpc,
    getUser,
    capture,
    record,
    bootstrap,
    buildDigest,
  };
}
