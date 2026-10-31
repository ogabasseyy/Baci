// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listUcpSchemaFiles } from './list-ucp-schema-files';
import { UCP_FIXTURE_DIR } from './ucp-fixture-paths';

function readManifestFiles(): Record<string, string> {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  ).files;
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('list exactly the files in the manifest', () => {
    expect(listUcpSchemaFiles()).toEqual(Object.keys(readManifestFiles()));
  });
});
