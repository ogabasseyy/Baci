import { copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import { assertServedResponseBytes } from './merchant-image-pilot-preflight-served-checks.mjs';
import {
  labHtml,
  MERCHANT,
  serveStaged,
  setupOffline,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

// Offline-verified digests for the labHtml fixture URLs, mirroring what
// runOfflinePreflight pins: manifest tier hashes keyed by served path.
function stagedHashesFor(fixture) {
  return Object.fromEntries(
    fixture.tiers.map((tier) => [
      `/__pilot/${fixture.generationId}/${tier.path}`,
      tier.sha256,
    ])
  );
}

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
        stagedHashes: stagedHashesFor(fixture),
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
        stagedHashes: stagedHashesFor(fixture),
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

  it('rejects oversized served bodies without buffering them', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        // Runaway origin: correct content type, unbounded body. The gate
        // must fail on overflow instead of buffering the whole response.
        res.writeHead(200, { 'content-type': 'image/avif' });
        for (let i = 0; i < 200; i += 1) {
          res.write(Buffer.alloc(64 * 1024, 0x61));
        }
        res.end();
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
        stagedHashes: stagedHashesFor(fixture),
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/exceeded the staged/);
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

  it('threads the offline-verified digests into the served gate', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      if ((req.url ?? '') === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      // Zeroed pins: staged bytes no longer match the offline verdict,
      // so the served gate must fail on the pins — proving the map is
      // threaded through, not silently ignored.
      const zeroed = Object.fromEntries(
        Object.keys(stagedHashesFor(fixture)).map((path) => [
          path,
          '0'.repeat(64),
        ])
      );
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
        stagedHashes: zeroed,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(
        /changed after offline verification/
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('preflight served response bytes vs offline pins', () => {
  async function withStaticOrigin(fixture, run) {
    const server = createServer((req, res) => {
      void serveStaged(res, fixture.publicDir, req.url ?? '');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      return await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it('passes served bytes that match the offline-verified digests', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    await withStaticOrigin(fixture, async (origin) => {
      const failures = await assertServedResponseBytes(html, {
        arm: 'pilot',
        origin,
        publicDir: fixture.publicDir,
        stagedHashes: stagedHashesFor(fixture),
        timeoutMs: 5000,
      });
      expect(failures).toEqual([]);
    });
  });

  it('fails a staged file swapped after offline verification', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    // Same-width cross-format swap: the replacement decodes to the
    // descriptor width, so only the offline pin catches it. The origin
    // serves the swapped bytes, which agree with the staged reread —
    // the old two-mutable-views comparison stayed green here.
    const avif96 = fixture.tiers.find(
      (tier) => tier.format === 'avif' && tier.width === 96
    );
    const webp96 = fixture.tiers.find(
      (tier) => tier.format === 'webp' && tier.width === 96
    );
    const stageDir = join(fixture.publicDir, '__pilot', fixture.generationId);
    await copyFile(join(stageDir, webp96.path), join(stageDir, avif96.path));
    await withStaticOrigin(fixture, async (origin) => {
      const failures = await assertServedResponseBytes(html, {
        arm: 'pilot',
        origin,
        publicDir: fixture.publicDir,
        stagedHashes: stagedHashesFor(fixture),
        timeoutMs: 5000,
      });
      expect(failures.join('\n')).toMatch(/changed after offline verification/);
    });
  });

  it('fails closed on URLs without an offline-verified digest', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    await withStaticOrigin(fixture, async (origin) => {
      const failures = await assertServedResponseBytes(html, {
        arm: 'pilot',
        origin,
        publicDir: fixture.publicDir,
        stagedHashes: {},
        timeoutMs: 5000,
      });
      expect(failures.join('\n')).toMatch(/no offline-verified hash/);
    });
  });
});
