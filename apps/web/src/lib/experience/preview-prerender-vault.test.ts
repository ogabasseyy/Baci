import { expect, it } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPreviewVault } from './preview-service';

function setup() {
  let now = 0;
  let active = true;
  const vault = createPreviewVault({
    origin: 'http://127.0.0.1:4101',
    now: () => now,
    isActive: async () => active,
  });
  const bytes = Buffer.from('export{}');
  const ref = vault.create({
    ownerId: 'owner',
    bindingId: 'lease',
    buildDigest: 'a'.repeat(64),
    files: [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes,
        digest: digestBytes(bytes),
      },
    ],
  });
  return {
    vault,
    ref,
    expire: () => {
      now = 600000;
    },
    revoke: () => {
      active = false;
    },
  };
}
it('returns a private immutable prerender document through the existing ticket reader', async () => {
  const f = setup();
  const launch = await f.vault.consumePrerender(
    'owner',
    f.ref,
    async (resources) =>
      `<!doctype html><h1>Prerender ${resources[0].path}</h1>`
  );
  const ticket = new URL(launch.src).pathname.split('/')[2];
  const resource = await f.vault.read(ticket, 'index.html');
  expect(Buffer.from(resource.bytes).toString()).toContain('Prerender app.js');
  expect(() => f.vault.consume('owner', f.ref)).toThrow('LAUNCH_EXPIRED');
  f.revoke();
  await expect(f.vault.read(ticket, 'index.html')).rejects.toThrow(
    'LAUNCH_EXPIRED'
  );
});
it.each([
  'expire',
  'revoke',
] as const)('rejects %s while rendering and does not return a usable launch', async (action) => {
  const f = setup();
  await expect(
    f.vault.consumePrerender('owner', f.ref, async () => {
      f[action]();
      return '<h1>Too late</h1>';
    })
  ).rejects.toThrow('LAUNCH_EXPIRED');
});

it('revokes staged resources when a renderer exceeds the document budget', async () => {
  const f = setup();
  let assetTicket = '';
  await expect(
    f.vault.consumePrerender('owner', f.ref, async (resources) => {
      assetTicket = new URL(resources[0].url).pathname.split('/')[2];
      return 'x'.repeat(4194305);
    })
  ).rejects.toThrow('QUOTA_EXCEEDED');
  await expect(f.vault.read(assetTicket, 'app.js')).rejects.toThrow(
    'NOT_FOUND'
  );
});
