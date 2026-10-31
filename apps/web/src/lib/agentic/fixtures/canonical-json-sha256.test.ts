// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJsonSha256 } from './canonical-json-sha256';
import { UCP_FIXTURE_DIR } from './ucp-fixture-paths';

function readManifestFiles(): Record<string, string> {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  ).files;
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('match the manifest hashes regardless of formatting', () => {
    const files = readManifestFiles();

    const actual = Object.fromEntries(
      Object.keys(files).map((file) => [
        file,
        canonicalJsonSha256(readFileSync(join(UCP_FIXTURE_DIR, file))),
      ])
    );

    expect(actual).toEqual(files);
  });

  it('hash the parsed JSON, so whitespace changes are ignored', () => {
    expect(canonicalJsonSha256('{"a": [1,\n 2]}')).toBe(
      canonicalJsonSha256('{"a":[1,2]}')
    );
    expect(canonicalJsonSha256('{"a":[1,2]}')).not.toBe(
      canonicalJsonSha256('{"a":[1,3]}')
    );
  });
});
