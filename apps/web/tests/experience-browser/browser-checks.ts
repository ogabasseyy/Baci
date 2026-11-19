import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import {
  type Browser,
  chromium,
  firefox,
  selectors,
  webkit,
} from 'playwright-core';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';
import {
  collectSemanticNodes,
  renderSemanticSnapshot,
  type SemanticSnapshot,
  semanticElements,
  semanticEngine,
  semanticText,
  validateSemanticSnapshot,
} from '../../tools/experience-runner/semantic-snapshot';
import {
  type QualificationInput,
  startQualificationServers,
} from './harness-server';
import { checkNativeLinks } from './native-link-checks';

async function main() {
  let raw = '';
  for await (const part of process.stdin) {
    raw += part;
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Error('Input budget');
  }
  const input = JSON.parse(raw) as QualificationInput;
  await selectors.register('baciSemantic', semanticEngine, {
    contentScript: true,
  });
  if (input.mode === 'output-flood' || input.mode === 'mixed-output-flood') {
    console.error('OUTPUT_FLOOD_STARTED');
    process.stdout.write(
      'x'.repeat((input.mode === 'output-flood' ? 17 : 8) * 1024 * 1024)
    );
    if (input.mode === 'mixed-output-flood')
      process.stderr.write('e'.repeat(9 * 1024 * 1024));
    return;
  }
  const started = performance.now();
  const servers: Server[] = [];
  const snapshots = new Map<string, SemanticSnapshot>();
  let browser: Browser | undefined;
  const checks: Record<string, unknown> = {};
  try {
    const running = await startQualificationServers(input, snapshots);
    servers.push(...running.servers);
    browser = await { chromium, firefox, webkit }[input.engine].launch({
      ...browserProcessPolicy(input.engine, process.env),
      headless: true,
      timeout: 12000,
      ...(input.engine === 'chromium' ? { chromiumSandbox: true } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: input.width, height: 844 },
    });
    page.setDefaultTimeout(2500);
    if (input.mode === 'infinite-render') {
      console.error('INFINITE_RENDER_STARTED');
      await page.goto('http://127.0.0.1:4100/', { waitUntil: 'commit' });
      await new Promise(() => {
        /* Deliberately wait for the external supervisor deadline. */
      });
      return;
    }
    await page.goto('http://127.0.0.1:4100/');
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { level: 1 }).waitFor();
    const child = page
      .frames()
      .find((f) => f.url().startsWith('http://127.0.0.1:4101/'));
    assert.ok(child);
    await frame
      .getByRole('img', { name: 'Synthetic blue swatch' })
      .evaluate(async (e) => {
        await (e as HTMLImageElement).decode();
        assertImage();
        function assertImage() {
          if ((e as HTMLImageElement).naturalWidth !== 32)
            throw Error('Image decode failed');
        }
      });
    const loaded = await child.evaluate(async () => {
      try {
        const faces = await document.fonts.load(
          '20px OfflineFixture',
          'USD 10.00'
        );
        const authored = await document.fonts.load(
          '20px QualificationAuthored',
          'USD 10.00'
        );
        return (
          authored.length > 0 &&
          authored.every((f) => f.status === 'loaded') &&
          faces.length > 0 &&
          faces.every((f) => f.status === 'loaded')
        );
      } catch {
        return false;
      }
    });
    assert.ok(loaded, 'Offline font decode failed');
    checks.offlineImageFontDecoded = true;
    await child.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'no-semantic-alternative';
      document.body.append(canvas);
    });
    let canvasRejected = false;
    try {
      await collectSemanticNodes(child);
    } catch {
      canvasRejected = true;
    }
    assert.ok(
      canvasRejected,
      'Canvas without a semantic alternative was accepted'
    );
    await child.locator('#no-semantic-alternative').evaluate((e) => e.remove());
    checks.canvasRequiresSemanticAlternative = true;
    if (input.mode === 'attack') {
      assert.equal(
        await child.evaluate(() => {
          try {
            return parent.document.title;
          } catch {
            return 'denied';
          }
        }),
        'denied'
      );
      assert.equal(
        await child.evaluate(() => {
          try {
            return localStorage.length;
          } catch {
            return 'denied';
          }
        }),
        'denied'
      );
      assert.equal(
        await child.evaluate(() => {
          try {
            return document.cookie;
          } catch {
            return 'denied';
          }
        }),
        'denied'
      );
      assert.equal(
        await child.evaluate(() =>
          fetch('http://127.0.0.1:4100/forbidden').then(
            () => false,
            () => true
          )
        ),
        true
      );
      assert.equal(
        await child.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              try {
                const socket = new WebSocket('ws://127.0.0.1:4100/forbidden');
                socket.onerror = () => resolve(true);
                socket.onopen = () => {
                  socket.close();
                  resolve(false);
                };
              } catch {
                resolve(true);
              }
            })
        ),
        true
      );
      assert.equal(
        await child.evaluate(() => {
          try {
            parent.location.href = 'http://127.0.0.1:4100/forbidden';
            return false;
          } catch {
            return true;
          }
        }),
        true
      );
      assert.equal(
        await child.evaluate(() => {
          try {
            return window.open('http://127.0.0.1:4100/forbidden') === null;
          } catch {
            return true;
          }
        }),
        true
      );
      await child.evaluate(() => {
        parent.postMessage(
          {
            type: 'open',
            routeId: 'https://private.invalid',
            requestId: 'forged',
          },
          '*'
        );
        const form = document.createElement('form');
        form.action = 'http://127.0.0.1:4100/forbidden';
        form.method = 'POST';
        document.body.append(form);
        form.requestSubmit();
      });
      assert.equal(await page.locator('#presentation').isVisible(), false);
      assert.equal(running.getForbiddenRequests(), 0);
      assert.equal(page.context().pages().length, 1);
      for (const key of [
        'BACI_OUTPUT_TICKET',
        'OPENAI_API_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ])
        assert.equal(
          process.env[key],
          undefined,
          'Inherited credential or output ticket'
        );
      assert.throws(() =>
        readFileSync('/var/tmp/baci-experience-checkpoint-a/host-only-marker')
      );
      assert.throws(() => writeFileSync('/rootfs-write-probe', 'synthetic'));
      await child.evaluate(() => {
        document.querySelectorAll =
          (() => []) as unknown as typeof document.querySelectorAll;
        window.getComputedStyle = (() => ({
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        })) as typeof window.getComputedStyle;
        Object.defineProperty(Node.prototype, 'textContent', {
          get: () => 'FORGED_SEMANTICS',
        });
      });
      const independent = await collectSemanticNodes(child);
      assert.ok(semanticElements(independent).some((n) => n.tag === 'h1'));
      assert.ok(
        !JSON.stringify(independent).match(
          /FORGED_SEMANTICS|HIDDEN_SENTINEL|MODAL_SENTINEL|INVISIBLE_SENTINEL|NESTED_CSS_SENTINEL/
        )
      );
      checks.sourceCannotForgeExtraction = true;
      checks.frameEscapesDenied = true;
      checks.credentialAndHostFilesAbsent = true;
    } else {
      const noJS = await browser.newContext({ javaScriptEnabled: false });
      const crawler = await noJS.newPage();
      for (let i = 0; i < 4; i++) {
        await frame.getByRole('navigation').getByRole('button').nth(i).click();
        await frame
          .locator('main > p')
          .filter({
            hasText: new RegExp(
              `\\b${['home', 'collection', 'product', 'editorial'][i]}\\b`
            ),
          })
          .first()
          .waitFor();
        const path = new URL(page.url()).pathname;
        const nodes = await collectSemanticNodes(child);
        const snapshot = validateSemanticSnapshot({
          revision: 'synthetic-1',
          path,
          nodes,
        });
        assert.ok(semanticElements(nodes).some((n) => n.tag === 'h1'));
        assert.ok(
          semanticElements(nodes).some(
            (n) => semanticText(n.children).trim() === 'USD 10.00'
          )
        );
        assert.ok(
          semanticElements(nodes).some(
            (n) =>
              semanticText(n.children).trim() === 'Below fold semantic content'
          )
        );
        assert.ok(
          !JSON.stringify(snapshot).match(
            /HIDDEN_SENTINEL|MODAL_SENTINEL|INVISIBLE_SENTINEL|NESTED_CSS_SENTINEL|private\.invalid/
          )
        );
        snapshots.set(path, snapshot);
        await crawler.goto(`http://127.0.0.1:4100${path}`);
        assert.equal(
          await crawler.getByRole('heading', { level: 1 }).textContent(),
          await frame.getByRole('heading', { level: 1 }).textContent()
        );
        await crawler.getByText('USD 10.00', { exact: true }).waitFor();
        await crawler
          .getByText('Below fold semantic content', { exact: true })
          .waitFor();
      }
      await noJS.close();
      checks.crawlableRouteParity = 4;
      assert.throws(() =>
        renderSemanticSnapshot(snapshots.values().next().value, 'synthetic-2')
      );
      checks.staleRevisionRejected = true;
      Object.assign(checks, await checkNativeLinks(page, frame));
    }
    console.log(
      JSON.stringify({
        status: 'passed',
        mode: input.mode,
        engine: input.engine,
        width: input.width,
        checks,
        wallMs: Math.round(performance.now() - started),
      })
    );
  } finally {
    await browser?.close();
    for (const server of servers) server.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
