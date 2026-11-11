import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyInvoicePdfBuildTrace } from './verify-invoice-pdf-build-traces.mjs';

async function fixture(t, { omitChromium = false, oversized = false, stale = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'baci-pdf-trace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const routeFile = join(root, 'route.js');
  const bin = 'node_modules/@sparticuz/chromium/bin';
  await mkdir(join(root, bin), { recursive: true });
  await writeFile(routeFile, 'route');
  if (oversized) await truncate(routeFile, 251 * 1024 * 1024);
  const assets = ['al2023.tar.br', 'fonts.tar.br', 'swiftshader.tar.br'];
  if (!omitChromium) assets.push('chromium.br');
  const files = assets.map((asset) => `${bin}/${asset}`);
  for (const file of files) await writeFile(join(root, file), 'asset');
  if (stale) files.push('missing.js');
  await writeFile(`${routeFile}.nft.json`, JSON.stringify({ files }));
  return routeFile;
}

test('accepts a route trace with all four packaged Chromium assets', async (t) => {
  const route = await fixture(t);
  assert.equal(await verifyInvoicePdfBuildTrace(route), 25);
});

test('rejects a trace that omits the executable', async (t) => {
  const route = await fixture(t, { omitChromium: true });
  await assert.rejects(verifyInvoicePdfBuildTrace(route), /missing Chromium assets: chromium.br/);
});

test('rejects a trace above the function budget', async (t) => {
  const route = await fixture(t, { oversized: true });
  await assert.rejects(verifyInvoicePdfBuildTrace(route), /above the 250 MiB function budget/);
});

test('names the route and unreadable file when a trace entry is stale', async (t) => {
  const route = await fixture(t, { stale: true });
  await assert.rejects(verifyInvoicePdfBuildTrace(route), {
    message: `${route} cannot read traced file missing.js`,
  });
});

test('counts duplicate trace entries toward the deployment budget', async (t) => {
  const route = await fixture(t);
  const tracePath = `${route}.nft.json`;
  const { readFile } = await import('node:fs/promises');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  trace.files.push(trace.files[0]);
  await writeFile(tracePath, JSON.stringify(trace));
  assert.equal(await verifyInvoicePdfBuildTrace(route), 30);
});

test('rejects an asset with the right basename in a nested directory', async (t) => {
  const route = await fixture(t, { omitChromium: true });
  const tracePath = `${route}.nft.json`;
  const { readFile } = await import('node:fs/promises');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  trace.files.push('node_modules/@sparticuz/chromium/bin/nested/chromium.br');
  await writeFile(tracePath, JSON.stringify(trace));
  await assert.rejects(verifyInvoicePdfBuildTrace(route), /missing Chromium assets: chromium.br/);
});
