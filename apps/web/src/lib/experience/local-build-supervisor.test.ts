import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { beforeEach, vi } from 'vitest';

import { registerBuildCapacityCase } from './local-build-capacity.test-support';
import { registerBuildLifecycleCases } from './local-build-lifecycle.test-support';
import { registerBuildPerformanceCases } from './local-build-performance.test-support';

const f = vi.hoisted(() => ({
  accept: vi.fn(async () => 'transient'),
  finalize: vi.fn(async () => ({ buildId: 'build', buildDigest: 'digest' })),
  fail: vi.fn(async () => ({ data: null, error: null })),
  existingBuild: null as {
    id: string;
    build_digest: string;
    host_origin: string;
  } | null,
  assets: [] as Array<{
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>,
  job: {
    id: 'j',
    status: 'queued',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    artifact_id: 'artifact',
    source_digest: '',
    attempt_nonce: 'attempt',
  },
  manifest: {
    format: 'baci.experience/v2' as const,
    runtime: 'react-browser-sandbox/v1' as const,
    sdkVersion: 'commerce-bridge/v1' as const,
    entry: 'Experience.tsx',
    files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
    packages: [],
    routes: [{ path: '/', view: 'home' as const }],
    assets: [] as Array<{ assetId: string; alt: string }>,
    capabilities: [] as ExperienceManifest['capabilities'],
  },
}));

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
  ownerRpcArgs: vi.fn(() => ({})),
}));
vi.mock('./repository', () => ({
  createExperienceRepository: vi.fn(() => ({
    loadOwnedJob: vi.fn(async () => f.job),
  })),
}));
vi.mock('./asset-service', () => ({
  loadOfflineAssets: vi.fn(async () => f.assets),
}));
vi.mock('./catalog-adapter', () => ({
  loadOwnerPreviewCatalog: vi.fn(async () => ({
    catalog: { products: [], revision: 'r' },
    currency: 'NGN',
  })),
}));
vi.mock('../../../tools/experience-runner/output-receiver', () => ({
  acceptJobOutput: f.accept,
  signJobTicket: vi.fn(() => 'ticket'),
}));
vi.mock('../../../tools/experience-runner/private-build-payload', () => ({
  packPrivateBuild: vi.fn((manifest) => manifest),
}));
vi.mock('./finalize-build', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    finalizeExperienceBuild: f.finalize,
  };
});

import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { runExperienceBuild } from './local-build-supervisor';
import { digestBytes } from './manifest-digest';

const hostOrigin = 'http://127.0.0.1:4100';
const validCandidate = (javascript = 'export default 1;', css = '') => ({
  javascript,
  css,
  hostOrigin,
  imports: [],
  digest: digestBytes(`${javascript}\0${css}`),
});
const deps = (execute: (kind: string, input: unknown) => Promise<unknown>) => ({
  key: new Uint8Array(32),
  toolchainDigest: 'toolchain',
  hostOrigin,
  transient: Object.assign(createTransientOutputStore(), {
    read: vi.fn(() => validCandidate()),
  }),
  recordVerifiedEvidence: vi.fn(async () => {}),
  bootstrap: {
    catalog: { products: [], revision: 'r' },
    capabilities: [],
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: 'r',
    },
  },
  execute: execute as never,
});
const context = {
  merchantId: 'merchant',
  supabase: {
    rpc: vi.fn(async (name: string) =>
      name === 'experience_fail_build' ? f.fail() : { data: null, error: null }
    ),
    from: vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data:
            table === 'experience_builds'
              ? f.existingBuild
              : { manifest: f.manifest },
          error: null,
        }),
      };
      return query;
    }),
  },
} as never;

beforeEach(() => {
  f.accept.mockClear();
  f.finalize.mockClear();
  f.fail.mockClear();
  f.assets = [];
  f.manifest.assets = [];
  f.job.source_digest = sourceDigest(f.manifest);
  f.job.status = 'queued';
  f.existingBuild = null;
  f.job.expires_at = new Date(Date.now() + 600000).toISOString();
});

const fixture = {
  f,
  context,
  deps,
  hostOrigin,
  validCandidate,
  runExperienceBuild,
};
export type BuildSupervisorTestFixture = typeof fixture;
registerBuildLifecycleCases(fixture);
registerBuildCapacityCase(fixture);
registerBuildPerformanceCases(fixture);
