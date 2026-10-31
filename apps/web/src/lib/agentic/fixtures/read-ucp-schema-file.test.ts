// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readUcpSchemaFile } from './read-ucp-schema-file';

describe('readUcpSchemaFile', () => {
  it('parses a vendored schema file relative to the fixture directory', () => {
    expect(readUcpSchemaFile('schemas/ucp.json')).toMatchObject({
      $id: 'https://ucp.dev/schemas/ucp.json',
    });
  });
});
