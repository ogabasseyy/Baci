import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchIsolatedBrowser } from './browser-session.mjs';
import {
  platformOrigin,
  platformPort,
  storefrontHost,
  storefrontPort,
} from './config.mjs';
import { reportFailure } from './failure-diagnostics.mjs';
import { buildFixture, startFixtureServer } from './fixture-server.mjs';
import { runTenantA } from './scenario-tenant-a.mjs';
import { runTenantB } from './scenario-tenant-b.mjs';
import { teardown } from './teardown.mjs';
import {
  assertPortAvailable,
  createTlsCertificate,
  startTlsProxy,
  waitForHttps,
  writeCaddyfile,
} from './tls.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'baci-chatwoot-browser-'));
const certPath = path.join(tempDir, 'localhost-cert.pem');
const keyPath = path.join(tempDir, 'localhost-key.pem');
const caddyfilePath = path.join(tempDir, 'Caddyfile');

// Shared run state: scenarios record evidence here so that the failure report
// and teardown can read it even when a later phase throws.
const state = {
  tempDir,
  phase: 'setup',
  proxy: undefined,
  frontServer: undefined,
  browser: undefined,
  page: undefined,
  tenantAInboxId: undefined,
  tenantBResult: undefined,
  untrustedFrameProbe: undefined,
  tenantACookieMetadata: undefined,
  tenantBDocumentCookieMetadata: undefined,
  blockedOrigins: new Set(),
  browserSignals: {
    consoleErrors: [],
    pageErrors: 0,
    failedLocalRequests: 0,
  },
};

try {
  state.phase = 'check local ports';
  await assertPortAvailable(storefrontHost, storefrontPort);
  await assertPortAvailable(storefrontHost, platformPort);

  state.phase = 'create temporary TLS certificate';
  await createTlsCertificate({ certPath, keyPath });
  await writeCaddyfile({ caddyfilePath, certPath, keyPath });

  state.phase = 'start local TLS proxy';
  state.proxy = startTlsProxy({ caddyfilePath, tempDir });
  state.phase = 'wait for local TLS proxy';
  await waitForHttps(`${platformOrigin}/packs/js/sdk.js`, state.proxy);

  state.phase = 'build storefront fixture';
  const siteDir = await buildFixture({ certPath, keyPath, tempDir });

  state.phase = 'serve bundled storefront fixture';
  state.frontServer = await startFixtureServer({ certPath, keyPath, siteDir });

  state.phase = 'launch isolated browser';
  const context = await launchIsolatedBrowser(state);

  const tenantA = await runTenantA(state, context);
  await runTenantB(state, context, tenantA);
} catch (error) {
  await reportFailure(error, state);
  process.exitCode = 1;
} finally {
  await teardown(state);
}
