// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { catalog, widths } from './fixtures';

describe.skipIf(process.env.BACI_BUILDER_FEASIBILITY !== '1')(
  'real browser public/widget parity',
  () => {
    it('compares six block geometry and inherited styles at all required widths', async () => {
      const output = await build({
        entryPoints: ['tools/builder-preview-spike/browser-entry.tsx'],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        write: false,
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
      });
      const globals = await postcss([
        tailwind({ base: process.cwd() }),
      ]).process(await readFile('src/app/globals.css', 'utf8'), {
        from: 'src/app/globals.css',
      });
      const records: unknown[] = [];
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? '');
        if (request.url?.startsWith('/api/storefront/products?')) {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              products: catalog.products.map((product) => ({
                ...product,
                status: 'active',
              })),
            })
          );
        } else {
          response.setHeader('content-type', 'text/html');
          response.end(
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0">${request.url === '/public' ? `<style>${globals.css}</style>` : ''}<div id="root"></div><script>${output.outputFiles[0].text}</script>`
          );
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing server port');
      const browser = await chromium.launch({
        headless: true,
        channel: 'chrome',
      });
      try {
        for (const width of widths) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
          });
          const publicPage = await context.newPage();
          const preview = await context.newPage();
          await Promise.all([
            publicPage.clock.setFixedTime(new Date(catalog.capturedAt)),
            preview.clock.setFixedTime(new Date(catalog.capturedAt)),
          ]);
          const errors: string[] = [];
          for (const page of [publicPage, preview])
            page.on('pageerror', (error) => errors.push(error.message));
          await Promise.all([
            publicPage.goto(`http://127.0.0.1:${address.port}/public`),
            preview.goto(`http://127.0.0.1:${address.port}/widget`),
          ]);
          await Promise.all([
            publicPage.getByText('Authorized fixture camera').waitFor(),
            preview.getByText('Authorized fixture camera').waitFor(),
          ]);
          const measure = async (page: typeof preview) =>
            page.locator('[data-baci-block]').evaluateAll((elements) =>
              elements.map((element) => {
                const box = element.getBoundingClientRect();
                const child = element.firstElementChild ?? element;
                const style = getComputedStyle(child);
                return {
                  type: element.getAttribute('data-baci-block'),
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: box.height,
                  color: style.color,
                  background: style.backgroundColor,
                  font: style.fontFamily,
                  padding: style.padding,
                  columns: getComputedStyle(
                    element.querySelector('.baci-products') ?? child
                  ).gridTemplateColumns,
                };
              })
            );
          expect(await measure(preview)).toEqual(await measure(publicPage));
          const widgetImage = await preview.screenshot({
            fullPage: true,
            animations: 'disabled',
          });
          const publicImage = await publicPage.screenshot({
            fullPage: true,
            animations: 'disabled',
          });
          await writeFile(`/tmp/baci-widget-${width}.png`, widgetImage);
          await writeFile(`/tmp/baci-public-${width}.png`, publicImage);
          expect(
            widgetImage.equals(publicImage),
            `Pixel parity at ${width}`
          ).toBe(true);
          expect(
            await preview
              .locator('.baci-home')
              .evaluate((element) => getComputedStyle(element).backgroundColor)
          ).toBe('rgb(250, 245, 255)');
          expect(await preview.locator('[data-baci-block]').count()).toBe(6);
          expect(await preview.locator('a[href]').count()).toBe(0);
          expect(await publicPage.locator('a[href]').count()).toBeGreaterThan(
            0
          );
          expect(
            await preview
              .locator('.baci-home')
              .evaluate((element) => element.scrollWidth <= window.innerWidth)
          ).toBe(true);
          expect(errors).toEqual([]);
          records.push({ width, blocks: await measure(preview) });
          console.info(
            JSON.stringify({ width, blocks: await measure(preview) })
          );
          await context.close();
        }
        expect(
          requests.filter((url) => url.startsWith('/api/storefront/products?'))
        ).toHaveLength(3);
        await writeFile(
          '/tmp/baci-builder-preview-parity.json',
          JSON.stringify(
            {
              browser: browser.version(),
              publicCss: 'compiled src/app/globals.css with Tailwind',
              records,
            },
            null,
            2
          )
        );
      } finally {
        await browser.close();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }, 60000);
  }
);
