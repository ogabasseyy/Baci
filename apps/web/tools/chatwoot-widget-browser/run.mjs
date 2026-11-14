import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { sendSyntheticMessage } from './send-synthetic-message.mjs';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const storefrontHost = '::1';
const storefrontAuthority = 'localhost';
const storefrontPort = Number(
  process.env.CHATWOOT_FIXTURE_STOREFRONT_PORT ?? 43128
);
const resetDelayMs = Number(process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS ?? '0');
const platformPort = Number(
  process.env.CHATWOOT_FIXTURE_PLATFORM_PORT ?? 43129
);
const storefrontOrigin = `https://${storefrontAuthority}:${storefrontPort}`;
const platformOrigin = `https://${storefrontAuthority}:${platformPort}`;
const chatwootHttpOrigin = 'http://127.0.0.1:43119';

const tokenFile = process.env.CHATWOOT_SYNTHETIC_TOKENS_FILE;
const fileTokens = tokenFile
  ? JSON.parse(await readFile(tokenFile, 'utf8'))
  : {};
const tokenA = process.env.CHATWOOT_SYNTHETIC_TOKEN_A ?? fileTokens.a;
const tokenB = process.env.CHATWOOT_SYNTHETIC_TOKEN_B ?? fileTokens.b;
const publicTokenPattern = /^[A-Za-z0-9_-]{16,128}$/;
if (
  typeof tokenA !== 'string' ||
  typeof tokenB !== 'string' ||
  !publicTokenPattern.test(tokenA) ||
  !publicTokenPattern.test(tokenB) ||
  tokenA === tokenB
) {
  throw new Error('Provide two distinct synthetic Chatwoot website tokens');
}
if (
  !Number.isInteger(resetDelayMs) ||
  resetDelayMs < 0 ||
  resetDelayMs > 2000
) {
  throw new Error('Synthetic reset delay must be an integer from 0 to 2000 ms');
}
process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS = String(resetDelayMs);

async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, host, () => server.close(resolve));
  });
}

function waitForHttps(url, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = () => {
      if (child.exitCode !== null) {
        reject(new Error('Local TLS proxy exited before becoming ready'));
        return;
      }
      const request = https.get(
        url,
        { rejectUnauthorized: false },
        (response) => {
          response.resume();
          resolve();
        }
      );
      request.setTimeout(1000, () => request.destroy());
      request.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for local TLS proxy'));
        } else {
          setTimeout(poll, 200);
        }
      });
    };
    poll();
  });
}

function cookieClaims() {
  const raw = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('cw_conversation='))
    ?.slice('cw_conversation='.length);
  if (!raw) return null;
  const payload = raw.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) return null;
  try {
    return JSON.parse(
      atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
    );
  } catch {
    return null;
  }
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'baci-chatwoot-browser-'));
const certPath = path.join(tempDir, 'localhost-cert.pem');
const keyPath = path.join(tempDir, 'localhost-key.pem');
const caddyfilePath = path.join(tempDir, 'Caddyfile');
let proxy;
let frontServer;
let browser;
let page;
let tenantAInboxId;
let tenantBResult;
let untrustedFrameProbe;
let tenantACookieMetadata;
let tenantBDocumentCookieMetadata;
const blockedOrigins = new Set();
const browserSignals = {
  consoleErrors: [],
  pageErrors: 0,
  failedLocalRequests: 0,
};
let phase = 'setup';

try {
  phase = 'check local ports';
  await assertPortAvailable(storefrontHost, storefrontPort);
  await assertPortAvailable(storefrontHost, platformPort);

  phase = 'create temporary TLS certificate';
  const openssl = spawn(
    process.env.OPENSSL_BIN ?? '/usr/bin/openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' }
  );
  await new Promise((resolve, reject) => {
    openssl.once('error', reject);
    openssl.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Could not create temporary TLS certificate'))
    );
  });

  await writeFile(
    caddyfilePath,
    `{
  admin off
  auto_https disable_redirects
}

https://${storefrontAuthority}:${platformPort} {
  bind ${storefrontHost}
  tls ${certPath} ${keyPath}
  reverse_proxy ${new URL(chatwootHttpOrigin).host}
}
`
  );

  phase = 'start local TLS proxy';
  proxy = spawn(
    process.env.CADDY_BIN ?? '/opt/homebrew/bin/caddy',
    ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(tempDir, 'caddy-config'),
        XDG_DATA_HOME: path.join(tempDir, 'caddy-data'),
      },
    }
  );
  phase = 'wait for local TLS proxy';
  await waitForHttps(`${platformOrigin}/packs/js/sdk.js`, proxy);

  phase = 'build storefront fixture';
  process.env.CHATWOOT_FIXTURE_CERT = certPath;
  process.env.CHATWOOT_FIXTURE_KEY = keyPath;
  process.env.CHATWOOT_FIXTURE_PLATFORM_ORIGIN = platformOrigin;
  process.env.CHATWOOT_FIXTURE_STOREFRONT_PORT = String(storefrontPort);
  process.env.CHATWOOT_SYNTHETIC_TOKEN_A = tokenA;
  process.env.CHATWOOT_SYNTHETIC_TOKEN_B = tokenB;
  const siteDir = path.join(tempDir, 'site');
  await build({
    configFile: path.join(fixtureDir, 'vite.config.ts'),
    mode: 'production',
    build: { outDir: siteDir, emptyOutDir: true },
  });

  phase = 'serve bundled storefront fixture';
  const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
  ]);
  const fixtureCsp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'unsafe-inline' ${platformOrigin}`,
    `style-src 'self' 'unsafe-inline' ${platformOrigin}`,
    `img-src 'self' data: blob: ${platformOrigin}`,
    `font-src 'self' data: ${platformOrigin}`,
    `connect-src 'self' ${platformOrigin} ${platformOrigin.replace(/^https:/, 'wss:')}`,
    `frame-src 'self' ${platformOrigin}`,
  ].join('; ');
  frontServer = https.createServer(
    { cert: await readFile(certPath), key: await readFile(keyPath) },
    async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', storefrontOrigin);
        const pathname = decodeURIComponent(url.pathname);
        let candidate = path.resolve(
          siteDir,
          pathname.replace(/^\/+/, '') || 'index.html'
        );
        let relative = path.relative(siteDir, candidate);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          response.writeHead(403).end();
          return;
        }
        let body;
        try {
          body = await readFile(candidate);
        } catch {
          if (pathname.startsWith('/assets/')) throw new Error('Asset missing');
          candidate = path.join(siteDir, 'index.html');
          relative = 'index.html';
          body = await readFile(candidate);
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': fixtureCsp,
          'Content-Type':
            contentTypes.get(path.extname(candidate)) ??
            'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    }
  );
  await new Promise((resolve, reject) => {
    frontServer.once('error', reject);
    frontServer.listen(storefrontPort, storefrontHost, resolve);
  });

  phase = 'launch isolated browser';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname !== storefrontAuthority) {
      blockedOrigins.add(requestUrl.origin);
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' && browserSignals.consoleErrors.length < 6) {
      browserSignals.consoleErrors.push(
        message
          .text()
          .replace(/([?&]website_token=)[^&\s)]+/gi, '$1[redacted]')
          .replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]')
          .slice(0, 260)
      );
    }
  });
  page.on('pageerror', () => {
    browserSignals.pageErrors += 1;
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).hostname === storefrontAuthority) {
      browserSignals.failedLocalRequests += 1;
    }
  });

  phase = 'tenant A ready';
  await page.goto(`${storefrontOrigin}/synthetic-tenant-a/checkout?tenant=a`);
  assert.equal(
    await page.evaluate(
      () => window.__chatwootFixtureDocumentStart?.chatwootCookieCount
    ),
    0,
    'Isolated browser context started with stale Chatwoot cookies'
  );
  await page.waitForFunction(
    ({ expectedToken, expectedBaseUrl }) => {
      const target = window;
      return (
        target.$chatwoot?.websiteToken === expectedToken &&
        target.$chatwoot?.baseUrl === expectedBaseUrl &&
        target.__baciChatwootReadyKey?.includes(expectedToken)
      );
    },
    { expectedToken: tokenA, expectedBaseUrl: platformOrigin },
    { timeout: 60_000 }
  );
  const tenantAClaims = await page.evaluate(cookieClaims);
  assert.ok(
    tenantAClaims?.inbox_id,
    'Tenant A did not receive a widget session cookie'
  );
  tenantAInboxId = tenantAClaims.inbox_id;
  await page.evaluate((inboxId) => {
    sessionStorage.setItem('__chatwootPreviousInbox', String(inboxId));
  }, tenantAClaims.inbox_id);
  const tenantAWidgetFrame = page
    .frames()
    .find((frame) => new URL(frame.url()).pathname === '/widget');
  assert.ok(tenantAWidgetFrame, 'Tenant A Chatwoot widget frame was not found');
  const widgetToggleAvailable = await page.evaluate(
    () => typeof window.$chatwoot?.toggle === 'function'
  );
  assert.ok(
    widgetToggleAvailable,
    'Tenant A widget cannot be opened for the synthetic message check'
  );
  await page.evaluate(() => window.$chatwoot.toggle('open'));
  await tenantAWidgetFrame
    .getByRole('button', { name: 'Start Conversation' })
    .click({ timeout: 10_000 });
  phase = 'send synthetic tenant A message';
  const syntheticAMessage = await sendSyntheticMessage(
    page,
    tenantAWidgetFrame
  );
  tenantACookieMetadata = (await context.cookies(storefrontOrigin))
    .filter((cookie) => cookie.name.startsWith('cw_'))
    .map(({ name, domain, path: cookiePath, sameSite, secure, httpOnly }) => ({
      name:
        name === 'cw_conversation'
          ? 'conversation'
          : name.startsWith('cw_user_')
            ? 'user'
            : 'other',
      domain,
      path: cookiePath,
      sameSite,
      secure,
      httpOnly,
    }));
  await page.evaluate((resetDelayMs) => {
    const target = window;
    const widget = target.$chatwoot;
    if (!widget?.reset) throw new Error('SDK reset method unavailable');
    const originalReset = widget.reset.bind(widget);
    const originalOnMessage = target.onmessage;
    const matchesPreviousInbox = () => {
      const rawCookie = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('cw_conversation='))
        ?.slice('cw_conversation='.length);
      if (!rawCookie) return false;
      const payload = rawCookie
        .split('.')[1]
        ?.replace(/-/g, '+')
        .replace(/_/g, '/');
      if (!payload) return false;
      try {
        const claims = JSON.parse(
          atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
        );
        return (
          String(claims.inbox_id) ===
          sessionStorage.getItem('__chatwootPreviousInbox')
        );
      } catch {
        return false;
      }
    };
    target.onmessage = (event) => {
      let cookieWriteEvent = null;
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(
            event.data.replace(/^chatwoot-widget:/, '')
          );
          if (message.event === 'loaded' || message.event === 'setAuthCookie') {
            cookieWriteEvent = message.event;
          }
        } catch {
          cookieWriteEvent = null;
        }
      }
      const trackCookieWriteEvent =
        cookieWriteEvent !== null &&
        sessionStorage.getItem('__chatwootFixtureResetRequested') === 'true';
      const beforeMatchesTenantA = trackCookieWriteEvent
        ? matchesPreviousInbox()
        : false;
      const result = originalOnMessage?.call(target, event);
      if (trackCookieWriteEvent) {
        const rawEvents = sessionStorage.getItem(
          '__chatwootFixturePostResetLoadedEvents'
        );
        let events = [];
        try {
          events = JSON.parse(rawEvents ?? '[]');
        } catch {
          events = [];
        }
        events.push({
          event: cookieWriteEvent,
          resetTriggered: target.$chatwoot?.resetTriggered === true,
          sourceMatchesWidgetFrame:
            event.source ===
            document.getElementById('chatwoot_live_chat_widget')?.contentWindow,
          beforeMatchesTenantA,
          afterMatchesTenantA: matchesPreviousInbox(),
        });
        sessionStorage.setItem(
          '__chatwootFixturePostResetLoadedEvents',
          JSON.stringify(events.slice(-8))
        );
      }
      return result;
    };
    widget.reset = () => {
      sessionStorage.setItem('__chatwootFixtureResetRequested', 'true');
      const beforeMatchesTenantA = matchesPreviousInbox();
      const result = originalReset();
      target.__chatwootFixtureResetEvidence = {
        beforeMatchesTenantA,
        afterMatchesTenantA: matchesPreviousInbox(),
      };
      sessionStorage.setItem(
        '__chatwootFixtureResetEvidence',
        JSON.stringify(target.__chatwootFixtureResetEvidence)
      );
      if (resetDelayMs > 0) {
        const samples = [];
        const sampleCookie = () => {
          const matched = matchesPreviousInbox();
          if (samples.length === 0 || samples.at(-1) !== matched) {
            samples.push(matched);
            sessionStorage.setItem(
              '__chatwootFixtureResetCookieTransitions',
              JSON.stringify(samples)
            );
          }
        };
        sampleCookie();
        const interval = window.setInterval(sampleCookie, 10);
        window.setTimeout(
          () => window.clearInterval(interval),
          resetDelayMs - 50
        );
      }
      return result;
    };
  }, resetDelayMs);

  phase = 'defer tenant switch during checkout';
  await page.getByRole('button', { name: 'Switch to tenant B' }).click();
  await page.waitForFunction(
    () =>
      location.pathname.endsWith('/checkout') &&
      document.querySelector('[data-testid="fixture-route"]')?.textContent ===
        'checkout' &&
      document.querySelector('[data-testid="bridge-tenant"]') === null
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('__chatwootFixtureLoads')),
    '1'
  );
  assert.equal(
    await page.evaluate(() => location.pathname),
    '/synthetic-tenant-b/checkout'
  );

  phase = 'reset tenant A before reloading as tenant B';
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: 'Continue outside checkout' }).click(),
  ]);
  tenantBDocumentCookieMetadata = (await context.cookies(storefrontOrigin))
    .filter((cookie) => cookie.name.startsWith('cw_'))
    .map(({ name, domain, path: cookiePath, sameSite, secure, httpOnly }) => ({
      name:
        name === 'cw_conversation'
          ? 'conversation'
          : name.startsWith('cw_user_')
            ? 'user'
            : 'other',
      domain,
      path: cookiePath,
      sameSite,
      secure,
      httpOnly,
    }));
  await page.waitForFunction(
    ({ expectedToken }) => {
      const target = window;
      return (
        target.$chatwoot?.websiteToken === expectedToken &&
        target.__baciChatwootReadyKey?.includes(expectedToken) &&
        target.__chatwootFixtureDocumentStart?.loads === 2
      );
    },
    { expectedToken: tokenB },
    { timeout: 60_000 }
  );
  tenantBResult = await page.evaluate(() => {
    const target = window;
    const rawCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('cw_conversation='))
      ?.slice('cw_conversation='.length);
    let current;
    if (rawCookie) {
      const payload = rawCookie
        .split('.')[1]
        ?.replace(/-/g, '+')
        .replace(/_/g, '/');
      if (payload) {
        try {
          current = JSON.parse(
            atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
          );
        } catch {
          current = undefined;
        }
      }
    }
    return {
      documentStart: target.__chatwootFixtureDocumentStart,
      previousInbox: sessionStorage.getItem('__chatwootPreviousInbox'),
      currentInbox: current?.inbox_id ?? null,
      bridgeTenant: document.querySelector('[data-testid="bridge-tenant"]')
        ?.textContent,
      resetEvidence: (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem('__chatwootFixtureResetEvidence') ?? 'null'
          );
        } catch {
          return null;
        }
      })(),
      postResetLoadedEvents: (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem('__chatwootFixturePostResetLoadedEvents') ??
              '[]'
          );
        } catch {
          return [];
        }
      })(),
      resetCookieTransitions: (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem('__chatwootFixtureResetCookieTransitions') ??
              '[]'
          );
        } catch {
          return [];
        }
      })(),
    };
  });
  untrustedFrameProbe = await page.evaluate(
    async ({ marker, widgetMessage }) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      const result = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMessage, true);
          frame.remove();
          resolve(value);
        };
        const onMessage = (event) => {
          if (event.source !== frame.contentWindow) return;
          window.setTimeout(() => {
            const cookie = document.cookie
              .split('; ')
              .find((entry) => entry.startsWith('cw_conversation='));
            finish({
              received: true,
              opaqueOrigin: event.origin === 'null',
              sourceIsWidgetFrame:
                event.source ===
                document.getElementById('chatwoot_live_chat_widget')
                  ?.contentWindow,
              cookieWriteAccepted: cookie === `cw_conversation=${marker}`,
            });
          }, 0);
        };
        window.addEventListener('message', onMessage, true);
        const script = `parent.postMessage(${JSON.stringify(widgetMessage)}, "*")`;
        frame.srcdoc = ['<script>', script, '</script>'].join('');
        document.body.append(frame);
        window.setTimeout(() => finish({ received: false }), 2_000);
      });
      return result;
    },
    {
      marker: 'baci-synthetic-untrusted-iframe-cookie',
      widgetMessage: `chatwoot-widget:${JSON.stringify({
        event: 'loaded',
        config: { authToken: 'baci-synthetic-untrusted-iframe-cookie' },
      })}`,
    }
  );
  phase = 'assert tenant B isolation';
  await page.evaluate(() => window.$chatwoot?.toggle?.('open'));
  const tenantBWidgetFrame = page
    .frames()
    .find((frame) => new URL(frame.url()).pathname === '/widget');
  assert.ok(tenantBWidgetFrame, 'Tenant B Chatwoot widget frame was not found');
  await tenantBWidgetFrame
    .getByRole('button', { name: 'Start Conversation' })
    .waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  const tenantBMessageCount = await tenantBWidgetFrame
    .getByText(syntheticAMessage, { exact: true })
    .count();
  assert.equal(
    tenantBMessageCount,
    0,
    'Tenant A synthetic message appeared in tenant B widget'
  );
  assert.equal(
    tenantBResult.documentStart?.conversationCookieMatchesPreviousInbox,
    false,
    'Tenant A conversation cookie remained at tenant B document start'
  );
  assert.equal(
    tenantBResult.documentStart?.chatwootCookieCount,
    0,
    'A stale Chatwoot cookie remained at tenant B document start'
  );
  assert.deepEqual(tenantBResult.resetEvidence, {
    beforeMatchesTenantA: true,
    afterMatchesTenantA: false,
  });
  assert.equal(tenantBResult.previousInbox, String(tenantAClaims.inbox_id));
  assert.notEqual(tenantBResult.currentInbox, tenantAClaims.inbox_id);
  assert.equal(tenantBResult.bridgeTenant, 'synthetic-tenant-b');
  assert.deepEqual([...blockedOrigins], []);
  console.log(
    `Sanitized reset cookie evidence: ${JSON.stringify({
      resetEvidence: tenantBResult.resetEvidence,
      postResetLoadedEvents: tenantBResult.postResetLoadedEvents,
      resetCookieTransitions: tenantBResult.resetCookieTransitions,
      tenantACookieMetadata,
      tenantBDocumentCookieMetadata,
      tenantBStartCookiePresent: Boolean(
        tenantBResult.documentStart?.conversationCookiePresent
      ),
      untrustedFrameProbe,
    })}`
  );
  await context.close();
  console.log(
    'Synthetic Chatwoot lifecycle passed: tenant A message visible in A and absent in B; no external origins requested.'
  );
} catch (error) {
  const safeError = String(error?.message ?? error ?? 'Unknown error')
    .replaceAll(tokenA, '[tenant A token redacted]')
    .replaceAll(tokenB, '[tenant B token redacted]')
    .replace(/([?&]website_token=)[^&\s)]+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .slice(0, 800);
  console.error(
    `Synthetic Chatwoot browser lifecycle failed during: ${phase} (${error?.name ?? 'Error'}): ${safeError}`
  );
  if (page && phase === 'tenant A ready') {
    const diagnostic = await page
      .evaluate(() => {
        const target = window;
        return {
          sdkRunAvailable: typeof target.chatwootSDK?.run === 'function',
          widgetGlobalCreated: Boolean(target.$chatwoot),
          iframeCreated: Boolean(
            document.getElementById('chatwoot_live_chat_widget')
          ),
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          pagePath: location.pathname,
          scriptPaths: [...document.scripts].map((script) => {
            try {
              return new URL(script.src).pathname;
            } catch {
              return 'inline';
            }
          }),
          readyEventRecorded: Boolean(target.__baciChatwootReadyKey),
          cspViolations: target.__chatwootFixtureCspViolations ?? [],
        };
      })
      .catch(() => ({ pageUnavailable: true }));
    console.error(
      `Sanitized browser diagnostics: ${JSON.stringify({ ...diagnostic, ...browserSignals })}`
    );
  } else if (page && phase === 'assert tenant B isolation') {
    console.error(
      `Sanitized final assertion diagnostics: ${JSON.stringify({
        pagePath: '/synthetic-tenant-b/product',
        documentStartCookiePresent: Boolean(
          tenantBResult?.documentStart?.conversationCookiePresent
        ),
        documentStartChatwootCookieCount:
          tenantBResult?.documentStart?.chatwootCookieCount ?? null,
        documentStartCookieMatchesTenantA: Boolean(
          tenantBResult?.documentStart?.conversationCookieMatchesPreviousInbox
        ),
        resetEvidence: tenantBResult?.resetEvidence ?? null,
        resetCookieTransitions: tenantBResult?.resetCookieTransitions ?? [],
        postResetLoadedEvents: tenantBResult?.postResetLoadedEvents ?? [],
        untrustedFrameProbe,
        tenantACookieMetadata,
        tenantBDocumentCookieMetadata,
        previousInboxMatchesTenantA:
          tenantBResult?.previousInbox === String(tenantAInboxId),
        currentInboxMatchesTenantA:
          String(tenantBResult?.currentInbox) === String(tenantAInboxId),
        bridgeTenant: tenantBResult?.bridgeTenant ?? null,
        blockedOrigins: [...blockedOrigins],
        ...browserSignals,
      })}`
    );
  } else if (page && phase === 'reset tenant A before reloading as tenant B') {
    // Intentionally boolean-only: never expose conversation or inbox IDs.
    const diagnostic = await page
      .evaluate((expectedToken) => {
        const target = window;
        const rawCookie = document.cookie
          .split('; ')
          .find((entry) => entry.startsWith('cw_conversation='))
          ?.slice('cw_conversation='.length);
        let current;
        if (rawCookie) {
          const payload = rawCookie
            .split('.')[1]
            ?.replace(/-/g, '+')
            .replace(/_/g, '/');
          if (payload) {
            try {
              current = JSON.parse(
                atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
              );
            } catch {
              current = undefined;
            }
          }
        }
        const previous = sessionStorage.getItem('__chatwootPreviousInbox');
        return {
          pagePath: location.pathname,
          fixtureLoads: sessionStorage.getItem('__chatwootFixtureLoads'),
          documentStart: target.__chatwootFixtureDocumentStart ?? null,
          cookiePresent: Boolean(current),
          currentInboxMatchesPrevious: Boolean(
            current?.inbox_id && String(current.inbox_id) === previous
          ),
          bridgeTenant:
            document.querySelector('[data-testid="bridge-tenant"]')
              ?.textContent ?? null,
          readyForTenantB: Boolean(
            target.__baciChatwootReadyKey?.includes(expectedToken)
          ),
        };
      }, tokenB)
      .catch(() => ({ pageUnavailable: true }));
    console.error(
      `Sanitized final assertion diagnostics: ${JSON.stringify({ ...diagnostic, blockedOrigins: [...blockedOrigins], ...browserSignals })}`
    );
  }
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch {
    console.error('Could not close the isolated browser process cleanly.');
  }
  if (frontServer?.listening) {
    await new Promise((resolve) => frontServer.close(resolve));
  }
  if (proxy && proxy.exitCode === null) {
    proxy.kill('SIGTERM');
    await new Promise((resolve) => {
      proxy.once('exit', resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  await rm(tempDir, { recursive: true, force: true });
}
