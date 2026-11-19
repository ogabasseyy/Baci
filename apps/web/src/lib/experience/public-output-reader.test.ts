// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPublicOutputReader } from './public-output-reader';

it('reads only verified public files and rejects malformed hex/private output', async () => {
  const bytes = Buffer.from('export{}');
  const build = 'a'.repeat(64);
  const head = {
    version: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    buildDigest: build,
    policyRevision: 'p',
    assetsDigest: 'b'.repeat(64),
    routes: [{ path: '/', view: 'home' }],
    capabilities: [],
  };
  let corrupt = false;
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'experience_public_manifest'
        ? head
        : {
            path: 'app.js',
            digest: digestBytes(bytes),
            mime: 'text/javascript',
            hex: corrupt ? 'secret' : bytes.toString('hex'),
          },
  }));
  const reader = createPublicOutputReader({ rpc } as never);
  expect((await reader.read('qa1', build, 'app.js'))?.bytes).toEqual(bytes);
  corrupt = true;
  expect(await reader.read('qa1', build, 'app.js')).toBeNull();
  rpc.mockClear();
  expect(await reader.read('qa1', build, 'source.tsx')).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});
