import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
        merchantId: MERCHANT,
        slotId: 'mobile-hero-slide-0',
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
    const mounts = await writeMountsFile([
      {
        binding: `${MERCHANT}/hero-s0`,
        merchantId: MERCHANT,
        slotId: 'mobile-hero-slide-0',
      },
    ]);
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      `--store-map=${MERCHANT}=ogabassey`,
      '--chrome=/nonexistent/chrome-for-tests',
      `--mounts=${mounts}`,
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/browser-launch/);
  });
});
