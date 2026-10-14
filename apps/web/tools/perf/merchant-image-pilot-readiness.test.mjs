import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSampleStoreIds } from './merchant-image-pilot-readiness-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'merchant-image-pilot-readiness.mjs');
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function runCli(argv) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...argv], (error, stdout) =>
      resolve({ error, stdout })
    );
  });
}

async function writeMountsFile(mounts) {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-readiness-'));
  const path = join(dir, 'mounts.json');
  await writeFile(path, JSON.stringify(mounts));
  return path;
}

// The readiness gate needs real Chrome for surface collection, which unit
// CI cannot provide. These tests pin the fail-closed CLI contract that
// runs before any browser launches: usage errors and launch failures
// report ok:false with named checks instead of crashing or hanging.
describe('merchant-image-pilot-readiness gate', () => {
  it('fails closed without origin, store-map, or chrome', async () => {
    const { error, stdout } = await runCli([]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/usage/);
  });

  it('fails closed on a malformed store map', async () => {
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      '--store-map=not-a-map',
      '--chrome=/nonexistent/chrome',
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/usage/);
  });

  it('fails closed on unknown profiles', async () => {
    const mounts = await writeMountsFile([
      {
        binding: `${MERCHANT}/hero-s0`,
        generationId: 'g',
        merchantId: MERCHANT,
        slotId: 'mobile-hero-slide-0',
        stagedOriginal: '/__pilot/originals/x.png',
      },
    ]);
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${MERCHANT}=ogabassey`,
      '--chrome=/nonexistent/chrome',
      `--mounts=${mounts}`,
      '--profiles=watch',
    ]);
    expect(error).not.toBe(null);
    expect(JSON.parse(stdout).ok).toBe(false);
  });

  it('fails closed without --mounts', async () => {
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${MERCHANT}=ogabassey`,
      '--chrome=/nonexistent/chrome',
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/usage/);
  });

  it('fails closed on a malformed mounts file', async () => {
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${MERCHANT}=ogabassey`,
      '--chrome=/nonexistent/chrome',
      '--mounts=/nonexistent/mounts.json',
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/usage/);
  });

  it('fails closed when the browser executable is missing', async () => {
    // Full-sample inputs: coverage is judged against the committed
    // sample, so a partial map would fail usage before reaching the
    // browser-launch stage this test targets.
    const sample = readSampleStoreIds();
    const mounts = await writeMountsFile(
      sample.map((merchantId) => ({
        binding: `${merchantId}/hero-s0`,
        generationId: 'g',
        merchantId,
        slotId: 'mobile-hero-slide-0',
        stagedOriginal: '/__pilot/originals/x.png',
      }))
    );
    const storeMap = sample
      .map((id, index) => `${id}=store-${index}`)
      .join(',');
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${storeMap}`,
      '--chrome=/nonexistent/chrome-for-tests',
      `--mounts=${mounts}`,
      '--public-dir=/nonexistent/public',
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/browser-launch/);
  });

  it('fails closed without --public-dir', async () => {
    // Control resolution derives physical widths from the staged
    // bytes: without the public dir the gate cannot verify the
    // control arm, so usage fails before any browser launches.
    const mounts = await writeMountsFile([
      {
        binding: `${MERCHANT}/hero-s0`,
        generationId: 'g',
        merchantId: MERCHANT,
        slotId: 'mobile-hero-slide-0',
        stagedOriginal: '/__pilot/originals/x.png',
      },
    ]);
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${MERCHANT}=ogabassey`,
      '--chrome=/nonexistent/chrome',
      `--mounts=${mounts}`,
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/usage/);
  });
});
