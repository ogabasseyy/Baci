import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import {
  contentTypeFor,
  labHtml,
  MERCHANT,
  setupOffline,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('preflight served gate', () => {
  it('fetches both arms and verifies descriptors against staged bytes', async () => {
    const fixture = await setupOffline();
    const original = `/__pilot/originals/${MERCHANT}-logo-a.png`;
    const serveFile = async (res, urlPath) => {
      try {
        const bytes = await readFile(join(fixture.publicDir, urlPath));
        res
          .writeHead(200, {
            'content-type': contentTypeFor(urlPath.split('?')[0]),
          })
          .end(bytes);
      } catch {
        res.writeHead(404).end('missing');
      }
    };
    const pages = {
      '/pilot-lab?arm=pilot': labHtml({ arm: 'pilot', ...fixture }),
      '/pilot-lab?arm=control': `<!doctype html><html><body><main data-pilot-lab-arm="control"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${original}" imageSrcSet="${original}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" data-pilot-lab-preload="control" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="control"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}"/></picture></section><section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="control"><source sizes="40px" srcSet="${original}" type="image/avif"/><source sizes="40px" srcSet="${original}" type="image/webp"/></picture></section></main></body></html>`,
    };
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      const body = pages[urlPath];
      if (body) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveFile(res, urlPath).catch(() => res.writeHead(500).end('error'));
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(
        report.checks.some(
          (check) => check.name === 'served:pilot:response-bytes' && check.ok
        )
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects descriptor lies and control-arm tier leaks over the wire', async () => {
    const fixture = await setupOffline();
    const good = labHtml({ arm: 'pilot', ...fixture });
    // Lie consistently in link and picture so owner agreement holds while
    // the descriptor no longer matches the decoded staged bytes.
    const lied = good.replaceAll(' 96w', ' 97w');
    const leakedControl = good
      .replaceAll('data-pilot-lab-arm="pilot"', 'data-pilot-lab-arm="control"')
      .replaceAll(
        'data-pilot-lab-preload="pilot"',
        'data-pilot-lab-preload="control"'
      )
      .replaceAll(
        'data-pilot-lab-picture="pilot"',
        'data-pilot-lab-picture="control"'
      );
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      let body = '';
      if (url === '/pilot-lab?arm=pilot') {
        body = lied;
      } else if (url === '/pilot-lab?arm=control') {
        body = leakedControl;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/descriptor|leak/i);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('treats loader-param descriptors as existence checks, not width lies', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const staged = logo.stagedOriginal;
    // Deliberately wrong ?w= descriptors over the real staged file: the
    // original renderers name requested widths, so this must pass.
    const controlHtml = `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${MERCHANT}/logo-a" data-pilot-lab-slot="header-logo"><img src="${staged}?w=9999&q=75" srcSet="${staged}?w=9999&q=75 1x" alt="Labstore" width="40" height="40"/></section></main></div></body></html>`;
    const passing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => controlHtml,
      publicDir: fixture.publicDir,
    });
    expect(passing.failures).toEqual([]);
    expect(passing.ok).toBe(true);
    // Same shape over a missing file: existence still fails closed.
    const missingHtml = controlHtml.replaceAll(
      staged,
      '/__pilot/originals/gone.png'
    );
    const failing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => missingHtml,
      publicDir: fixture.publicDir,
    });
    expect(failing.ok).toBe(false);
    expect(failing.failures.join('\n')).toMatch(/does not decode/);
  });

  it('keeps served check names stable when details contain separators', async () => {
    const fixture = await setupOffline();
    // Width lie: the srcSet claims 999w for a staged 384px tier.
    const html = labHtml({ arm: 'pilot', ...fixture }).replaceAll(
      '384w',
      '999w'
    );
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/hero-s0`, `${MERCHANT}/logo-a`],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    // Four width lies (hero/logo x avif/webp): every failing check keeps
    // the bare gate name and every entry carries one prefix.
    const failed = report.checks.filter((check) => !check.ok);
    expect(failed).toHaveLength(4);
    for (const check of failed) {
      expect(check.name).toBe('served:pilot:descriptors');
    }
    expect(report.failures).toHaveLength(4);
    for (const failure of report.failures) {
      expect(failure).toMatch(
        /^served:pilot:descriptors: descriptor 999w does not match oriented width 384: /
      );
    }
  });
});
