/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for CVE-2026-74866 (GHSA-gxm5-99cw-xjw9):
// `@fastify/busboy` retained bare CR/LF characters in multipart
// Content-Disposition `filename`/`name` parameters (including RFC 5987
// `filename*`/`name*` percent-encoded forms), enabling log, filesystem, or
// downstream-header injection. Fixed in 3.2.2 (see the
// `pnpm-workspace.yaml` override), which skips parts with bare line breaks.
// Mirrors the upstream `rejects bare CR or LF in disposition parameters`
// test so a future override downgrade fails loudly.

const require = createRequire(import.meta.url);
const resolvedPackageJsonPath = require.resolve('@fastify/busboy/package.json');
// Verification hook only: point at an unpacked @fastify/busboy tarball to
// confirm this test fails on pre-fix releases. Unset in normal runs.
const busboyRoot = process.env.BUSBOY_ROOT ?? dirname(resolvedPackageJsonPath);
const busboyPackageJsonPath = join(busboyRoot, 'package.json');

// First release that skips parts with bare CR/LF in name/filename.
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

function loadBusboy(): BusboyConstructor {
  const moduleExports = require(join(busboyRoot, 'index.js')) as unknown;
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

describe('@fastify/busboy CRLF integrity (CVE-2026-74866)', () => {
  it('resolves a busboy release containing the CRLF fix', () => {
    const busboyPackage = JSON.parse(
      readFileSync(busboyPackageJsonPath, 'utf8')
    ) as { version?: string };
    expect(typeof busboyPackage.version).toBe('string');
    const actual = parseVersion(busboyPackage.version as string);
    expect(isAtLeast(actual, FIRST_FIXED)).toBe(true);
  });

  it('skips parts with bare CR or LF in name/filename', async () => {
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
