import { expect, it } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPreviewVault } from './preview-service';

it('owner-bound one-use launch, expiry, immutable resource tickets and revocation', async () => {
  let now = 1000;
  let active = true;
  const bytes = Buffer.from('export{}');
  const vault = createPreviewVault({
    now: () => now,
    isActive: async () => active,
    origin: 'http://127.0.0.1:4101',
  });
  const ref = vault.create({
    ownerId: 'a',
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
  expect(() => vault.consume('b', ref)).toThrow('NOT_FOUND');
  const launch = vault.consume('a', ref);
  expect(() => vault.consume('a', ref)).toThrow('LAUNCH_EXPIRED');
  const file = launch.resources[0];
  expect(await vault.read(file.ticket, 'app.js')).toMatchObject({
    mime: 'text/javascript',
  });
  await expect(vault.read(file.ticket, '../app.js')).rejects.toThrow(
    'NOT_FOUND'
  );
  await expect(vault.read(file.ticket, 'app.js.map')).rejects.toThrow(
    'NOT_FOUND'
  );
  active = false;
  await expect(vault.read(file.ticket, 'app.js')).rejects.toThrow(
    'LAUNCH_EXPIRED'
  );
  active = true;
  now = 601000;
  await expect(vault.read(file.ticket, 'app.js')).rejects.toThrow(
    'LAUNCH_EXPIRED'
  );
});
it('revocation during async resource admission cannot return bytes', async () => {
  let release!: (v: boolean) => void;
  const vault = createPreviewVault({
    now: () => 1000,
    isActive: () => new Promise<boolean>((r) => (release = r)),
    origin: 'http://127.0.0.1:4101',
  });
  const bytes = Buffer.from('export{}');
  const ref = vault.create({
    ownerId: 'a',
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
  const resource = vault.consume('a', ref).resources[0];
  const read = vault.read(resource.ticket, 'app.js');
  vault.revoke('lease');
  release(true);
  await expect(read).rejects.toThrow('LAUNCH_EXPIRED');
});

it.each([
  ['hero', 'hero-large'],
  ['hero-large', 'hero'],
])('rewrites whole CSS asset references once regardless of prefix ordering: %s, %s', async (...ids) => {
  const vault = createPreviewVault({
    now: () => 1000,
    isActive: async () => true,
    origin: 'http://127.0.0.1:4101',
  });
  const css = `.a{background:url('/assets/hero')}.b{background:url("/assets/hero-large")}.c{background:url('/assets/missing')}.d{background:url('/assets/hero.png')}`;
  const files = [
    { path: 'app.js', mime: 'text/javascript', bytes: Buffer.from('export{}') },
    { path: 'app.css', mime: 'text/css', bytes: Buffer.from(css) },
    ...ids.map((id) => ({
      path: `assets/${id}`,
      mime: 'image/png',
      bytes: Buffer.from(id),
    })),
  ].map((file) => ({ ...file, digest: digestBytes(file.bytes) }));
  const ref = vault.create({
    ownerId: 'a',
    bindingId: 'lease',
    buildDigest: 'a'.repeat(64),
    files,
  });
  const launch = vault.consume('a', ref);
  const sheet = launch.resources.find((file) => file.path === 'app.css');
  const hero = launch.resources.find((file) => file.path === 'assets/hero');
  const large = launch.resources.find(
    (file) => file.path === 'assets/hero-large'
  );
  expect(sheet && hero && large).toBeTruthy();
  if (!sheet || !hero || !large) throw Error('MISSING_FIXTURE_RESOURCE');
  const result = await vault.read(sheet.ticket, sheet.path);
  const text = Buffer.from(result.bytes).toString('utf8');
  expect(text).toBe(
    `.a{background:url('${hero.url}')}.b{background:url("${large.url}")}.c{background:url('/assets/missing')}.d{background:url('/assets/hero.png')}`
  );
  expect(sheet.digest).toBe(digestBytes(text));
});
