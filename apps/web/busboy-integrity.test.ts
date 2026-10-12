/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for the three `@fastify/busboy` CVEs behind the
// `pnpm-workspace.yaml` override (fixed releases: 3.2.1 for the two DoS
// advisories, 3.2.2 for CRLF; the pin targets 3.2.2 which supersedes both):
//
// - CVE-2026-19481 (GHSA-x8mw-p69m-v3mx): DoS via prototype-named multipart
//   part headers (`__proto__`/`constructor` crashed the dicer header parser,
//   which stored headers on a plain `{}`).
// - CVE-2026-19484 (GHSA-xjh9-v7x6-24jw): DoS via oversized multipart
//   boundary (the Boyer-Moore-Horspool occurrence table was a Uint8Array, so
//   a 252-byte boundary wrapped the shift to zero and looped forever).
// - CVE-2026-74866 (GHSA-gxm5-99cw-xjw9): CRLF injection via multipart
//   Content-Disposition `filename`/`name` (including RFC 5987 `*` forms).
//
// Each behavioral case mirrors its upstream regression test so a future
// override downgrade fails loudly instead of silently restoring the parser
// bugs. The boundary case runs in a timeout-controlled child process so a
// vulnerable implementation cannot hang Vitest.

const require = createRequire(import.meta.url);
const resolvedPackageJsonPath = require.resolve('@fastify/busboy/package.json');

function resolveRoot(): { root: string; packageJsonPath: string } {
  const override = process.env.BUSBOY_ROOT;
  if (override !== undefined) {
    // Verification hook only: point at an unpacked @fastify/busboy tarball
    // to confirm this test fails on pre-fix releases. Refused under CI so a
    // green run always guards the workspace-resolved dependency.
    if (process.env.CI !== undefined) {
      throw new Error(
        'BUSBOY_ROOT is set in CI; refusing to test a non-installed copy'
      );
    }
    console.warn(`[integrity-test] testing busboy from override: ${override}`);
    return { root: override, packageJsonPath: join(override, 'package.json') };
  }
  const root = dirname(resolvedPackageJsonPath);
  return { root, packageJsonPath: join(root, 'package.json') };
}

const { root: busboyRoot, packageJsonPath: busboyPackageJsonPath } =
  resolveRoot();

// First release containing all three fixes.
const FIRST_FIXED = [3, 2, 2] as const;

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Unexpected @fastify/busboy version: ${version}`);
  }
  return parts as [number, number, number];
}

function isAtLeast(
  actual: [number, number, number],
  minimum: readonly [number, number, number]
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== minimum[index]) {
      return actual[index] > minimum[index];
    }
  }
  return true;
}

interface BusboyInstance {
  on: (event: string, listener: (...args: never[]) => void) => void;
  once: (event: string, listener: (...args: never[]) => void) => void;
  end: (data?: unknown) => void;
}

interface BusboyConstructor {
  new (options: { headers: Record<string, string> }): BusboyInstance;
}

function readPackageMain(): string {
  const busboyPackage = JSON.parse(
    readFileSync(busboyPackageJsonPath, 'utf8')
  ) as { main?: string };
  return busboyPackage.main ?? 'index.js';
}

function loadBusboy(): BusboyConstructor {
  const moduleExports = require(join(busboyRoot, readPackageMain())) as unknown;
  if (typeof moduleExports === 'function') {
    return moduleExports as BusboyConstructor;
  }
  const named = moduleExports as { Busboy?: BusboyConstructor };
  if (typeof named.Busboy === 'function') {
    return named.Busboy;
  }
  throw new Error(`Cannot load Busboy constructor from ${busboyRoot}`);
}

function buildBody(parts: string[][], boundary: string): string {
  const separator = `--${boundary}`;
  return `${parts.map((part) => [separator, ...part].join('\r\n')).join('\r\n')}\r\n${separator}--\r\n`;
}

async function collectField(
  Busboy: BusboyConstructor,
  headers: string[],
  boundary: string
): Promise<{ fields: [string, string][]; finished: boolean }> {
  const body = buildBody([[...headers, '', 'value']], boundary);
  const busboy = new Busboy({
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  const fields: [string, string][] = [];
  busboy.on('field', (name: string, value: string) => {
    fields.push([name, value]);
  });
  busboy.end(Buffer.from(body, 'binary'));
  await new Promise<void>((resolve, reject) => {
    busboy.once('finish', () => resolve());
    busboy.once('error', (error: Error) => reject(error));
  });
  return { fields, finished: true };
}

async function parseDisposition(
  Busboy: BusboyConstructor,
  disposition: string
): Promise<{ emitted: boolean; names: string[] }> {
  const boundary = 'integritycrlf';
  const body = buildBody(
    [[`Content-Disposition: ${disposition}`, '', 'value']],
    boundary
  );
  const busboy = new Busboy({
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  let emitted = false;
  const names: string[] = [];
  busboy.on('field', (name: string) => {
    emitted = true;
    names.push(name);
  });
  busboy.on('file', (name: string, stream: { resume: () => void }) => {
    emitted = true;
    names.push(name);
    stream.resume();
  });
  busboy.end(Buffer.from(body, 'binary'));
  await new Promise<void>((resolve, reject) => {
    busboy.once('finish', () => resolve());
    busboy.once('error', (error: Error) => reject(error));
  });
  return { emitted, names };
}

describe('@fastify/busboy integrity (CVE-2026-19481/19484/74866)', () => {
  it('resolves a busboy release containing all three fixes', () => {
    const busboyPackage = JSON.parse(
      readFileSync(busboyPackageJsonPath, 'utf8')
    ) as { version?: string };
    expect(typeof busboyPackage.version).toBe('string');
    const actual = parseVersion(busboyPackage.version as string);
    expect(isAtLeast(actual, FIRST_FIXED)).toBe(true);
  });

  it('tolerates prototype-named part headers (CVE-2026-19481)', async () => {
    const Busboy = loadBusboy();
    for (const name of ['__proto__', 'constructor']) {
      const { fields, finished } = await collectField(
        Busboy,
        ['Content-Disposition: form-data; name="field"', `${name}: injected`],
        'prototypeheader'
      );
      expect(finished).toBe(true);
      expect(fields).toEqual([['field', 'value']]);
    }
  });

  it('processes a fragmented 252-byte boundary without hanging (CVE-2026-19484)', () => {
    const entryPath = join(busboyRoot, readPackageMain());
    const script = [
      `const Busboy = require(${JSON.stringify(entryPath)})`,
      "const boundary = 'A'.repeat(252)",
      'const parser = new Busboy({',
      "  headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },",
      '})',
      "parser.write(Buffer.from('--' + boundary.slice(0, -1)))",
      "parser.write(Buffer.from('X'), (error) => process.exit(error ? 1 : 0))",
      'setTimeout(() => process.exit(1), 500)',
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 2000,
    });
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    }).toEqual({ error: undefined, signal: null, status: 0 });
  });

  it('skips parts with bare CR or LF in name/filename (CVE-2026-74866)', async () => {
    const Busboy = loadBusboy();
    const maliciousDispositions = [
      'form-data; name="field\rname"',
      'form-data; name="field\nname"',
      'form-data; name="field"; filename="file\rname.txt"',
      'form-data; name="field"; filename="file\nname.txt"',
      "form-data; name*=utf-8''field%0Dname",
      "form-data; name*=utf-8''field%0Aname",
      "form-data; name=field; filename*=utf-8''file%0Dname.txt",
      "form-data; name=field; filename*=utf-8''file%0Aname.txt",
    ];
    for (const disposition of maliciousDispositions) {
      const { emitted, names } = await parseDisposition(Busboy, disposition);
      expect(
        emitted,
        `Expected no event for ${disposition} (got: ${names.join(', ')})`
      ).toBe(false);
    }
  });

  it('still parses well-formed parts', async () => {
    const Busboy = loadBusboy();
    const { emitted, names } = await parseDisposition(
      Busboy,
      'form-data; name="field"'
    );
    expect(emitted).toBe(true);
    expect(names).toEqual(['field']);
  });
});
