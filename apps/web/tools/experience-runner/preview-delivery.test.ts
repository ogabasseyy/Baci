import { expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { createPreviewVault } from '../../src/lib/experience/preview-service';
import { productionDeliveryOrigins } from '../../src/lib/experience/production-origins';
import { createProductionPreviewDelivery } from './preview-delivery';

it('serves immutable output on a separate HTTPS site, rechecking revocation and blocking mutations', async () => {
  let active = true;
  const executionOrigin = 'https://artifacts.baci-execution.net';
  const vault = createPreviewVault({
    origin: executionOrigin,
    now: Date.now,
    isActive: async () => active,
  });
  const bytes = Buffer.from('export{}');
  const ref = vault.create({
    ownerId: 'synthetic-owner',
    bindingId: 'binding',
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
  const launch = vault.consume('synthetic-owner', ref);
  const file = launch.resources[0];
  const serve = createProductionPreviewDelivery({
    vault,
    executionOrigin,
    hostOrigins: ['https://builder.baci.test', 'https://shop.merchant.test'],
  });
  const response = await serve(new Request(file.url));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('export{}');
  expect(response.headers.get('content-security-policy')).toContain(
    "connect-src 'none'"
  );
  expect(response.headers.get('content-security-policy')).toContain(
    'frame-ancestors https://builder.baci.test https://shop.merchant.test'
  );
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  const opaque = await serve(
    new Request(file.url, { headers: { origin: 'null' } })
  );
  expect(opaque.status).toBe(200);
  expect(opaque.headers.get('access-control-allow-origin')).toBe('null');
  const hostile = await serve(
    new Request(file.url, { headers: { origin: 'https://evil.test' } })
  );
  expect(hostile.status).toBe(404);
  expect(hostile.headers.has('access-control-allow-origin')).toBe(false);
  const document = await serve(new Request(launch.src));
  expect(document.status).toBe(200);
  expect(document.headers.has('access-control-allow-origin')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  for (const request of [
    new Request(file.url, { method: 'POST' }),
    new Request(`${file.url}?bypass=1`),
    new Request(file.url.replace(executionOrigin, 'https://untrusted.test')),
    new Request(`${executionOrigin}/resource/${file.ticket}/app.js.map`),
  ])
    expect((await serve(request)).status).toBe(404);
  active = false;
  expect((await serve(new Request(file.url))).status).toBe(404);
});

it.each([
  ['https://execution.baci.co.uk', 'https://builder.baci.co.uk'],
  ['http://execution.other.test', 'https://builder.baci.test'],
  ['https://execution.other.test', 'https://builder.baci.test/path'],
  ['https://execution.other.test', 'https://builder.baci.test/#csp'],
])('rejects shared cookie sites and noncanonical origins (%s, %s)', (executionOrigin, hostOrigin) => {
  expect(() =>
    productionDeliveryOrigins({ executionOrigin, hostOrigins: [hostOrigin] })
  ).toThrow();
});

it('understands private suffixes when separating execution and merchant sites', () => {
  expect(
    productionDeliveryOrigins({
      executionOrigin: 'https://execution.github.io',
      hostOrigins: ['https://merchant.github.io'],
    }).executionOrigin
  ).toBe('https://execution.github.io');
  expect(() =>
    productionDeliveryOrigins({
      executionOrigin: 'https://nested.merchant.github.io',
      hostOrigins: ['https://merchant.github.io'],
    })
  ).toThrow();
});
