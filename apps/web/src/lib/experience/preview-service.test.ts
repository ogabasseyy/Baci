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

it('keeps a second merchant usable when the first merchant reaches its launch quota', async () => {
  const vault = createPreviewVault({
    now: () => 1000,
    isActive: async () => true,
    origin: 'http://127.0.0.1:4101',
  });
  const bytes = Buffer.from('export{}');
  const input = (merchantId: string, bindingId: string) => ({
    ownerId: 'same-owner',
    merchantId,
    bindingId,
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
  let admitted = 0;
  for (; admitted < 64; admitted++) {
    try {
      vault.create(input('merchant-a', `a-${admitted}`));
    } catch (error) {
      expect((error as Error).message).toBe('QUOTA_EXCEEDED');
      break;
    }
  }
  expect(admitted).toBeGreaterThan(0);
  expect(admitted).toBeLessThan(64);
  const b = vault.create(input('merchant-b', 'b'));
  const preview = await vault.consumePrerender(
    'same-owner',
    b,
    async () => '<main>Merchant B</main>'
  );
  expect(preview.bindingId).toBe('b');
  const ticket = new URL(preview.src).pathname.split('/')[2];
  expect(
    Buffer.from((await vault.read(ticket, 'index.html')).bytes).toString()
  ).toContain('Merchant B');
});

it('charges pending launches against a merchant prerender quota without blocking another merchant', async () => {
  const vault = createPreviewVault({
    now: () => 1000,
    isActive: async () => true,
    origin: 'http://127.0.0.1:4101',
  });
  const bytes = Buffer.alloc(15 * 1024 * 1024, 32);
  const large = (bindingId: string) =>
    vault.create({
      ownerId: 'owner',
      merchantId: 'a',
      bindingId,
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
  const first = large('first');
  large('pending');
  await expect(
    vault.consumePrerender('owner', first, async () =>
      'x'.repeat(3 * 1024 * 1024)
    )
  ).rejects.toThrow('QUOTA_EXCEEDED');
  const small = Buffer.from('export{}');
  const other = vault.create({
    ownerId: 'owner',
    merchantId: 'b',
    bindingId: 'other',
    buildDigest: 'a'.repeat(64),
    files: [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes: small,
        digest: digestBytes(small),
      },
    ],
  });
  expect(
    (await vault.consumePrerender('owner', other, async () => '<main>B</main>'))
      .bindingId
  ).toBe('other');
});

it('counts consumed and pending previews together, scopes merchants, and releases slots after revocation/expiry', () => {
  let now = 1000;
  const vault = createPreviewVault({
    now: () => now,
    isActive: async () => true,
    origin: 'http://localhost:4101',
  });
  const bytes = Buffer.from('export{}');
  const make = (merchantId: string, bindingId: string) => ({
    ownerId: 'owner',
    merchantId,
    bindingId,
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
  for (let i = 0; i < 8; i++) {
    const ref = vault.create(make('a', `a-${i}`));
    vault.consume('owner', ref);
  }
  expect(() => vault.create(make('a', 'extra'))).toThrow('QUOTA_EXCEEDED');
  for (const tenant of ['b', 'c', 'd'])
    for (let i = 0; i < 8; i++) {
      const ref = vault.create(make(tenant, `${tenant}-${i}`));
      if (i % 2 === 0) vault.consume('owner', ref);
    }
  expect(() => vault.create(make('e', 'extra'))).toThrow('QUOTA_EXCEEDED');
  vault.revoke('a-0');
  expect(() => vault.create(make('a', 'replacement'))).not.toThrow();
  now = 601001;
  expect(() => vault.create(make('a', 'after-expiry'))).not.toThrow();
});
