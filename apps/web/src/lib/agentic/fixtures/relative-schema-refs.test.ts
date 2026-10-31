// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { listUcpSchemaFiles } from './list-ucp-schema-files';
import { readUcpSchemaFile } from './read-ucp-schema-file';
import { relativeSchemaRefs } from './relative-schema-refs';
import { UCP_ROOT_SCHEMA_FILES } from './ucp-fixture-paths';

describe('vendored UCP 2026-04-08 schemas', () => {
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
});
