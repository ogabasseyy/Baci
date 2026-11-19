import { expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { createPreviewVault } from '../../src/lib/experience/preview-service';
import { startPreviewGateway } from './preview-gateway';

it('serves only active immutable tickets with opaque-frame security headers, then denies revoked reads', async () => {
  let active = true;
  const vault = createPreviewVault({
    now: Date.now,
    isActive: async () => active,
    origin: 'http://127.0.0.1:4101',
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
  const file = vault.consume('owner', ref).resources[0];
  const server = await startPreviewGateway(vault, 0, 'http://127.0.0.1:4100');
  try {
    const response = await fetch(
      `${server.origin}/resource/${file.ticket}/app.js`
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toBe('export{}');
    expect(
      (await fetch(`${server.origin}/resource/${file.ticket}/app.js.map`))
        .status
    ).toBe(404);
    active = false;
    expect(
      (await fetch(`${server.origin}/resource/${file.ticket}/app.js`)).status
    ).toBe(404);
  } finally {
    await server.close();
  }
});
