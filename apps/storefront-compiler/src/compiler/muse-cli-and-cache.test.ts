import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
  type PublicProjectedProduct,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';

function runBuiltCli(
  inputJson: string,
  cliPath: string
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `CLI exited ${code}: ${Buffer.concat(errChunks).toString('utf8')}`
          )
        );
        return;
      }
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(outChunks).toString('utf8'),
      });
    });
    child.stdin.end(inputJson);
  });
}

function linkNodeModulesInto(sourceDir: string, targetModules: string): void {
  if (!existsSync(sourceDir)) return;
  for (const entry of readdirSync(sourceDir)) {
    if (entry.startsWith('.')) continue;
    const srcEntry = path.join(sourceDir, entry);
    if (entry.startsWith('@')) {
      const scopeDest = path.join(targetModules, entry);
      mkdirSync(scopeDest, { recursive: true });
      for (const pkg of readdirSync(srcEntry)) {
        const dest = path.join(scopeDest, pkg);
        if (!existsSync(dest)) {
          symlinkSync(realpathSync(path.join(srcEntry, pkg)), dest, 'dir');
        }
      }
    } else {
      const dest = path.join(targetModules, entry);
      if (!existsSync(dest)) {
        symlinkSync(realpathSync(srcEntry), dest, 'dir');
      }
    }
  }
}

describe('Muse & CodeRabbit split-availability overlay and isolated CLI bundle', () => {
  it('merges per-variant and product stock flips in split-availability mode without re-running full catalog RPCs', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const products = generateOgabasseyBackingCatalog(20);
    products[0].variants[0].stockQty = 5;
    products[0].variants[1].stockQty = 3;

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products,
      generationSampleTtlMs: 15_000,
    });
    const pdpUrl = `https://catalog.baci.internal/v1/product?category=${products[0].categorySlug}&productSlug=${products[0].slug}`;

    const initialRes = await plane.handleOutboundFetch(
      new Request(pdpUrl),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    const initialBody = (await initialRes.json()) as {
      product: PublicProjectedProduct;
    };
    expect(initialBody.product.inStock).toBe(true);
    expect(initialBody.product.variants.every((v) => v.inStock)).toBe(true);
    expect(plane.telemetry.originCatalogRpcCalls).toBe(1);

    plane.recordInventoryWrite(merchantId, 0, 0);
    plane.advanceClockMs(15_001);

    const afterWriteRes = await plane.handleOutboundFetch(
      new Request(pdpUrl),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(afterWriteRes.headers.get('x-baci-cache')).toBe('HIT');
    const afterBody = (await afterWriteRes.json()) as {
      product: PublicProjectedProduct;
    };
    expect(afterBody.product.inStock).toBe(false);
    expect(afterBody.product.variants.every((v) => !v.inStock)).toBe(true);
    expect(plane.telemetry.originCatalogRpcCalls).toBe(1);
    expect(plane.telemetry.originAvailabilityRpcCalls).toBe(2);
  });

  it('produces a runnable dist/cli.mjs bundle that works in an isolated /opt-style deploy directory', async () => {
    const pkgRoot = path.resolve(import.meta.dirname, '../..');
    const repoNodeModules = path.resolve(pkgRoot, '../../node_modules');
    const tempDeployDir = mkdtempSync(path.join(os.tmpdir(), 'baci-cli-opt-'));
    try {
      writeFileSync(
        path.join(tempDeployDir, 'package.json'),
        JSON.stringify({ name: '@baci/storefront-compiler', private: true })
      );
      mkdirSync(path.join(tempDeployDir, 'dist'));
      const isolatedModules = path.join(tempDeployDir, 'node_modules');
      mkdirSync(isolatedModules);
      linkNodeModulesInto(path.join(pkgRoot, 'node_modules'), isolatedModules);
      linkNodeModulesInto(repoNodeModules, isolatedModules);
      copyFileSync(
        path.join(pkgRoot, 'dist/cli.mjs'),
        path.join(tempDeployDir, 'dist/cli.mjs')
      );
      const { code, stdout } = await runBuiltCli(
        JSON.stringify(createOgabasseyStorefrontManifest()),
        path.join(tempDeployDir, 'dist/cli.mjs')
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as {
        buildDigest: string;
        bindings: unknown[];
        workerCode: string;
      };
      expect(parsed.buildDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(parsed.bindings).toEqual([]);
      expect(parsed.workerCode.length).toBeGreaterThan(1000);
    } finally {
      rmSync(tempDeployDir, { recursive: true, force: true });
    }
  });

  it('accepts >2 MiB JSON-escaped valid <1 MiB UTF-8 manifests through CLI 8 MiB wire limit and pins Dockerfile digests', async () => {
    const pkgRoot = path.resolve(import.meta.dirname, '../..');
    const dockerfile = readFileSync(path.join(pkgRoot, 'Dockerfile'), 'utf8');
    const fromLines = dockerfile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('FROM '));
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    for (const line of fromLines) {
      expect(line).toMatch(/@sha256:[a-f0-9]{64}\b/);
    }

    const manifest = createOgabasseyStorefrontManifest();
    // 450 KiB of '\\' is < 512 KiB per-file and < 1 MiB total UTF-8,
    // while JSON escaping doubles it to > 900 KiB; across two files (~900 KiB raw -> > 1.8 MiB),
    // and using \x07 control chars inside a JS comment expands 6x (\u0007) to > 2.7 MiB JSON!
    const escapedCommentA = `// ${'\x07'.repeat(230_000)}\nexport const a = 1;`;
    const escapedCommentB = `// ${'\x07'.repeat(230_000)}\nexport const b = 2;`;
    manifest.files.push(
      { path: 'src/extra/a.ts', content: escapedCommentA },
      { path: 'src/extra/b.ts', content: escapedCommentB }
    );
    const wireJson = JSON.stringify(manifest);
    expect(Buffer.byteLength(wireJson, 'utf8')).toBeGreaterThan(
      2 * 1024 * 1024
    );

    const { code, stdout } = await runBuiltCli(
      wireJson,
      path.join(pkgRoot, 'dist/cli.mjs')
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { buildDigest: string };
    expect(parsed.buildDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
