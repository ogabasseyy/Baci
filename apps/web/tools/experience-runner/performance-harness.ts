import { randomUUID } from 'node:crypto';
import { createServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { LaunchOptions } from 'playwright-core';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import type { PerformanceWorkerInput } from '../../src/schemas/experience-performance-worker';
import { performanceCss, performanceOrigins } from './performance-origins';
import { createPerformanceTls } from './performance-tls';
import { startPerformanceTunnel } from './performance-tunnel';

/** Credential-free reference host. Commerce effects are unavailable during measurement. */
export async function startPerformanceHarness(input: PerformanceWorkerInput) {
  const { origin, hostPort, resourceOrigin, frameOrigin, transport } =
    performanceOrigins(input.bundle.hostOrigin);
  const base = `${resourceOrigin}/resource/${input.bundle.digest}`;
  const nonce = randomUUID();
  const bootstrap = {
    ...input.bootstrap,
    assets: Object.fromEntries(
      input.assets.map((a) => [a.assetId, `${base}/assets/${a.assetId}`])
    ),
  };
  const resources = new Map<string, { mime: string; bytes: Buffer }>([
    [
      `${base}/app.js`,
      { mime: 'text/javascript', bytes: Buffer.from(input.bundle.javascript) },
    ],
    [
      `${base}/app.css`,
      {
        mime: 'text/css',
        bytes: Buffer.from(
          performanceCss(
            input.bundle.css,
            base,
            input.assets.map((asset) => asset.assetId)
          )
        ),
      },
    ],
  ]);
  for (const asset of input.assets) {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    if (
      digestBytes(bytes) !== asset.digest ||
      bytes.toString('base64') !== asset.bytesBase64
    )
      throw Error('BUILD_FAILED');
    resources.set(`${base}/assets/${asset.assetId}`, {
      mime: asset.mime,
      bytes,
    });
  }
  const html =
    input.html ??
    `<!doctype html><html data-baci-performance-reference><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${base}/app.css"></head><body><div id="root"></div><script type="module" src="${base}/app.js"></script></body></html>`;
  const tls =
    transport === 'https-loopback-tls'
      ? createPerformanceTls([origin, resourceOrigin])
      : undefined;
  let tlsConnections = 0;
  const makeServer = (listener: RequestListener) => {
    const server = tls
      ? createHttpsServer(tls.options, listener)
      : createServer(listener);
    if (tls)
      server.on('secureConnection', () => {
        tlsConnections++;
      });
    return server;
  };
  const child = makeServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none';script-src 'self' ${resourceOrigin};style-src 'self' ${resourceOrigin} 'unsafe-inline';img-src 'self' ${resourceOrigin};font-src 'self' ${resourceOrigin};connect-src 'none';base-uri 'none';form-action 'none';frame-ancestors ${origin}`
    );
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (req.url === '/index.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return;
    }
    const resource = resources.get(`${resourceOrigin}${req.url}`);
    if (!resource) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', resource.mime);
    res.end(resource.bytes);
  });
  const bridge = `
const frame = document.querySelector('iframe');
frame.addEventListener('load', () => {
  const channel = new MessageChannel();
  const nonce = ${JSON.stringify(nonce)};
  const expectedEpoch = ${JSON.stringify(bootstrap.route.epoch)};
  const initialBootstrap = ${JSON.stringify(bootstrap)};
  let connected = false;
  let commitRequired = false;
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    delete document.documentElement.dataset.baciPerformanceBridgeReady;
    document.documentElement.dataset.baciPerformanceBridgeFailed = 'true';
    channel.port1.close();
  };
  const markReady = () => {
    if (!failed) document.documentElement.dataset.baciPerformanceBridgeReady = 'true';
  };
  channel.port1.onmessage = (event) => {
    const message = event.data;
    if (!connected) {
      if (
        !message ||
        typeof message !== 'object' ||
        message.type !== 'ready' ||
        message.nonce !== nonce ||
        (message.readiness !== undefined && message.readiness !== 'react-commit/v1')
      ) {
        fail();
        return;
      }
      connected = true;
      commitRequired = message.readiness === 'react-commit/v1';
      channel.port1.postMessage({ type: 'bootstrap', bootstrap: initialBootstrap });
      if (!commitRequired) markReady();
      return;
    }
    if (message?.type === 'render-failed') {
      fail();
      return;
    }
    if (message?.type === 'render-committed') {
      if (
        !commitRequired ||
        message.nonce !== nonce ||
        !Number.isSafeInteger(message.epoch) ||
        message.epoch > expectedEpoch
      ) {
        fail();
        return;
      }
      if (message.epoch === expectedEpoch) markReady();
      return;
    }
    if (typeof message?.requestId === 'string')
      channel.port1.postMessage({
        type: 'result',
        requestId: message.requestId,
        result: {
          status: 'error',
          code: 'INSUFFICIENT_SCOPE',
          message: 'Commerce effects are unavailable in performance qualification.',
        },
      });
  };
  channel.port1.start();
  frame.contentWindow.postMessage(
    {
      type: 'baci-experience-connect',
      nonce,
      instanceId: 'performance-reference',
      buildDigest: ${JSON.stringify(input.bundle.digest)},
    },
    '*',
    [channel.port2]
  );
});
`;
  const parent = makeServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none';script-src 'self';style-src 'unsafe-inline';frame-src ${frameOrigin};base-uri 'none';form-action 'none'`
    );
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (req.url === '/host.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bridge);
      return;
    }
    if (req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<!doctype html><html data-baci-performance-reference><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><p style="position:fixed;bottom:0;right:0;font:12px system-ui;z-index:1">Local performance preview</p><iframe title="Candidate storefront" sandbox="allow-scripts" style="display:block;width:100%;height:100svh;border:0" src="${frameOrigin}/index.html"></iframe><script src="/host.js" defer></script></body></html>`
    );
  });
  let tunnel: Awaited<ReturnType<typeof startPerformanceTunnel>> | undefined;
  const close = async () => {
    try {
      await tunnel?.close();
    } finally {
      await Promise.allSettled(
        [parent, child].map(async (server) => {
          server.closeAllConnections();
          if (server.listening)
            await new Promise<void>((resolve) => server.close(() => resolve()));
        })
      );
      tls?.close();
    }
  };
  try {
    for (const [server, port] of [
      [child, 4101],
      [parent, hostPort],
    ] as const)
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    if (tls) {
      const authority = (value: string) => {
        const url = new URL(value);
        return `${url.hostname}:${url.port || '443'}`;
      };
      tunnel = await startPerformanceTunnel(
        new Map([
          [authority(origin), hostPort],
          [authority(resourceOrigin), 4101],
        ])
      );
    }
    const chromiumOptions: LaunchOptions =
      tls && tunnel
        ? {
            args: [`--ignore-certificate-errors-spki-list=${tls.spki}`],
            proxy: { server: tunnel.origin },
          }
        : {};
    return {
      origin,
      close,
      chromiumOptions,
      transport,
      tlsConnections: () => tlsConnections,
      blockedRequests: () => tunnel?.blocked() ?? 0,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
