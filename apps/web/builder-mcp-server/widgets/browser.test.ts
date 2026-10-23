// @vitest-environment node

import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import {
  catalog,
  home,
  merchant,
  widths,
} from '../../tools/builder-preview-spike/fixtures';
import { createPreviewHtml } from './build.mjs';

it.skipIf(process.env.BACI_BUILDER_FEASIBILITY !== '1')(
  'renders the built widget through the real standard SDK at three widths without business effects',
  async () => {
    const { html } = await createPreviewHtml();
    const snapshot = {
      storefrontId: merchant.id,
      version: `draft:${merchant.id}`,
      pageSlug: 'home',
      projection: {
        config: home,
        identity: {
          ...merchant,
          logo_url: 'https://usebaci.com/preview-fixture.svg',
        },
        catalog: {
          ...catalog,
          products: catalog.products.map((product) => ({
            ...product,
            image: 'https://usebaci.com/preview-fixture.svg',
          })),
        },
        inert: true,
      },
      readiness: {
        ready: false,
        missingItems: ['At least one active product'],
      },
    };
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/widget') {
        res.end(html);
        return;
      }
      res.end(
        `<!doctype html><html><body style="margin:0"><iframe title="Baci preview" src="/widget" style="border:0;width:100%;height:1600px"></iframe><script>window.calls=[];const frame=document.querySelector('iframe');window.send=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');window.addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const m=event.data;if(m.method)window.calls.push(m.method);if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';if(m.id!==undefined&&m.method){let result={};if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'test-host',version:'1'},hostCapabilities:{openLinks:{}},hostContext:{theme:'dark',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}};else if(m.method==='ui/request-display-mode')result={mode:'inline'};frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');}if(m.method==='ui/notifications/initialized')window.send('ui/notifications/tool-result',{structuredContent:${JSON.stringify(snapshot)}});});</script></body></html>`
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error();
    const browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
    });
    const records: unknown[] = [];
    try {
      for (const width of widths) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        const errors: string[] = [];
        const requests: string[] = [];
        page.on('request', (request) => requests.push(request.url()));
        await page.route('https://usebaci.com/preview-fixture.svg', (route) =>
          route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#ede9fe"/><rect x="100" y="140" width="200" height="130" rx="20" fill="#6d28d9"/><circle cx="200" cy="200" r="45" fill="white"/></svg>',
          })
        );
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${address.port}/`);
        const frame = page.frameLocator('iframe');
        await frame.getByText('Authorized fixture camera').waitFor();
        expect(await frame.locator('[data-baci-block]').count()).toBe(6);
        await frame.getByText('© Fixture. All rights reserved.').waitFor();
        await frame.locator('img').evaluateAll((images) =>
          Promise.all(
            images.map((image) => {
              if (!(image instanceof HTMLImageElement))
                throw Error('Not an image');
              return image.decode();
            })
          )
        );
        expect(
          await frame
            .locator('img')
            .evaluateAll((images) =>
              images.every(
                (img) =>
                  img instanceof HTMLImageElement &&
                  img.complete &&
                  img.naturalWidth > 0
              )
            )
        ).toBe(true);
        expect(
          requests.every(
            (url) =>
              url.startsWith(`http://127.0.0.1:${address.port}/`) ||
              url === 'https://usebaci.com/preview-fixture.svg'
          )
        ).toBe(true);
        expect(await frame.locator('a[href]').count()).toBe(0);
        expect(
          await frame.locator('.builder-preview').getAttribute('data-theme')
        ).toBe('dark');
        const geometry = await frame
          .locator('[data-baci-block]')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              type: node.getAttribute('data-baci-block'),
              width: node.getBoundingClientRect().width,
              height: node.getBoundingClientRect().height,
            }))
          );
        expect(geometry.every((r) => r.width <= width && r.height > 0)).toBe(
          true
        );
        await frame.getByRole('button', { name: 'Expand preview' }).click();
        await frame
          .getByRole('alert')
          .filter({ hasText: 'Could not expand' })
          .waitFor();
        await page.screenshot({
          path: `/tmp/baci-builder-task7-${width}.png`,
          fullPage: true,
        });
        await page.evaluate(() => {
          const w = window as unknown as {
            send: (method: string, params: unknown) => void;
          };
          w.send('ui/notifications/tool-result', {
            isError: true,
            structuredContent: { code: 'CONNECTION_REVOKED' },
          });
        });
        await frame
          .getByRole('alert')
          .filter({ hasText: 'Reconnect' })
          .waitFor();
        expect(await frame.getByText('Authorized fixture camera').count()).toBe(
          0
        );
        const calls = await page.evaluate(
          () => (window as unknown as { calls: string[] }).calls
        );
        expect(calls).not.toContain('tools/call');
        expect(calls).not.toContain('ui/open-link');
        expect(errors).toEqual([]);
        records.push({ width, geometry, calls });
        await page.close();
      }
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await writeFile(
      '/tmp/baci-builder-task7-browser.json',
      JSON.stringify(records, null, 2)
    );
  },
  60000
);
