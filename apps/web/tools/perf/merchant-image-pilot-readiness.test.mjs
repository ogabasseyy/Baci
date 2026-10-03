import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'merchant-image-pilot-readiness.mjs');

function runCli(argv) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...argv], (error, stdout) =>
      resolve({ error, stdout })
    );
  });
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
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      '--store-map=6b5cb8a4-5575-456c-b936-8cdfae30db74=ogabassey',
      '--chrome=/nonexistent/chrome',
      '--profiles=watch',
    ]);
    expect(error).not.toBe(null);
    expect(JSON.parse(stdout).ok).toBe(false);
  });

  it('fails closed when the browser executable is missing', async () => {
    const { error, stdout } = await runCli([
      '--origin=http://localhost:3122',
      '--store-map=6b5cb8a4-5575-456c-b936-8cdfae30db74=ogabassey',
      '--chrome=/nonexistent/chrome-for-tests',
    ]);
    expect(error).not.toBe(null);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/browser-launch/);
  });
});
