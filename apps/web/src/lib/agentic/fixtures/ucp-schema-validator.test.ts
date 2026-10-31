// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VALID_UCP_CART } from './ucp-schema-samples';
import {
  canonicalJsonSha256,
  listUcpSchemaFiles,
  readUcpSchemaFile,
  relativeSchemaRefs,
  UCP_FIXTURE_DIR,
  UCP_ROOT_SCHEMA_FILES,
  UCP_SCHEMAS,
  validateUcpDocument,
} from './ucp-schema-validator';

const PINNED_COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function readManifest(): { commit: string; files: Record<string, string> } {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  );
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('match the manifest hashes regardless of formatting', () => {
    const { files } = readManifest();

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

  it('list exactly the files in the manifest', () => {
    expect(listUcpSchemaFiles()).toEqual(Object.keys(readManifest().files));
  });

  it('contain every file the root schemas reference', () => {
    const vendored = new Set(listUcpSchemaFiles());
    const reached = new Set<string>();
    const queue: string[] = [...UCP_ROOT_SCHEMA_FILES];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      expect(vendored.has(file), `${file} is not vendored`).toBe(true);
      queue.push(...relativeSchemaRefs(file, readUcpSchemaFile(file)));
    }

    expect([...reached].sort()).toEqual([...vendored]);
  });

  it('pin the upstream commit and keep the Apache-2.0 licence', () => {
    expect(readManifest().commit).toBe(PINNED_COMMIT);
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'SOURCE.md'), 'utf8')).toContain(
      PINNED_COMMIT
    );
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'LICENSE'), 'utf8')).toContain(
      'Apache License'
    );
  });
});

describe('validateUcpDocument', () => {
  it('ignores the request-side ucp_request annotation on responses', () => {
    const { errors } = validateUcpDocument(UCP_SCHEMAS.cart, VALID_UCP_CART);

    expect(errors).toEqual([]);
  });
});
