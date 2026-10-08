import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import {
  labHtml,
  MERCHANT,
  setupOffline,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('preflight served gate', () => {
  it('rejects served image bytes that differ from the staged hashes', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      // Correct HTML, wrong bytes: every image URL 404s.
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/response-bytes/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects staged-asset redirects even when the target bytes match', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        // Same bytes behind a redirect: the topology changed (extra hop,
        // possibly another host), so the gate must fail anyway.
        res.writeHead(302, { location: '/elsewhere/copy.avif' }).end();
        return;
      }
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/redirected/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects store-page redirects to the gallery', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath.startsWith('/pilot-lab/store/')) {
        // Same binding behind a redirect: the gate must certify the
        // matrix route, not the gallery it points at.
        res.writeHead(302, { location: '/pilot-lab?arm=pilot' }).end();
        return;
      }
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        pages: [
          {
            bindings: [`${MERCHANT}/logo-a`],
            path: '/pilot-lab/store/labstore',
            surface: 'store',
          },
        ],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/redirected/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('fails unreachable pages before any mount verdict', async () => {
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [],
      expectedMounts: [],
      fetchImpl: () => {
        throw new Error('connection refused');
      },
      publicDir: '/nonexistent',
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/reachable/);
  });
});
