// @vitest-environment node
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { qualifyBuildRender } from './qualify-build-render';

const candidate = {
  javascript: 'export{}',
  css: '',
  digest: digestBytes('export{}\0'),
  imports: [],
  hostOrigin: 'https://shop.synthetic.test',
};
function fixture() {
  const execute = vi.fn(async () => ({
    jobId: 'synthetic-capture',
    wallMs: 1,
    output: {
      status: 'passed',
      buildDigest: candidate.digest,
      screenshot: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
    },
  }));
  return {
    execute,
    candidate,
    independentOutput: candidate,
    readCandidate: vi.fn(() => candidate),
    manifest: {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: 'export default()=>null' }],
      packages: [],
      assets: [],
      routes: [{ path: '/', view: 'home' }],
      capabilities: [],
    } as ExperienceManifest,
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'synthetic',
      },
      catalog: { revision: 'synthetic', products: [] },
      capabilities: [],
    } as PublicBootstrap,
    hostOrigins: [candidate.hostOrigin, 'https://builder.baci.test'],
    assets: [],
  };
}
it('qualifies both exact parent origins across all engines and widths without losing digest checks', async () => {
  const input = fixture();
  const proofs = await qualifyBuildRender(input);
  expect(proofs).toHaveLength(12);
  expect(input.readCandidate).toHaveBeenCalledTimes(12);
  expect(new Set(proofs.map((proof) => proof.hostOrigin))).toEqual(
    new Set(input.hostOrigins)
  );
  expect(
    new Set(proofs.map((proof) => `${proof.engine}/${proof.width}`)).size
  ).toBe(6);
});
it('refuses invalid screenshot bytes and stale independent output before recording proof', async () => {
  const input = fixture();
  input.execute.mockResolvedValueOnce({
    jobId: 'bad',
    wallMs: 1,
    output: {
      status: 'passed',
      buildDigest: candidate.digest,
      screenshot: Buffer.from('not a PNG').toString('base64'),
    },
  });
  await expect(qualifyBuildRender(input)).rejects.toThrow('BUILD_FAILED');
  expect(input.execute).toHaveBeenCalledOnce();
  const other = fixture();
  await expect(
    qualifyBuildRender({
      ...other,
      independentOutput: { ...candidate, hostOrigin: 'https://other.test' },
    })
  ).rejects.toThrow('BUILD_FAILED');
});
it('bounds the parent-origin matrix before dispatching work', async () => {
  const input = fixture();
  await expect(
    qualifyBuildRender({ ...input, hostOrigins: [] })
  ).rejects.toThrow('BUILD_FAILED');
  await expect(
    qualifyBuildRender({
      ...input,
      hostOrigins: [...input.hostOrigins, 'https://extra.test'],
    })
  ).rejects.toThrow('BUILD_FAILED');
  expect(input.execute).not.toHaveBeenCalled();
});
