// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { UCP_SCHEMAS, validateUcpDocument } from '../ucp-schema-validator';

type JsonObject = Record<string, unknown>;

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2026-07-28';
// Every 2026-07-28 request must carry these in params._meta.
const REQUIRED_META_KEYS = [
  'io.modelcontextprotocol/protocolVersion',
  'io.modelcontextprotocol/clientCapabilities',
] as const;

function readFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function missingMetaKeys(params: JsonObject): string[] {
  const meta = record(params._meta);
  return REQUIRED_META_KEYS.filter((key) => !(key in meta));
}

describe('MCP 2026-07-28 request fixtures', () => {
  it.each([
    ['tools-list.request.json', 'tools/list'],
    ['tools-call.search-ucp-catalog.request.json', 'tools/call'],
  ])('%s is a stateless %s request', (file, method) => {
    const request = readFixture(file);
    const params = record(request.params);

    expect(request.jsonrpc).toBe('2.0');
    expect(request.method).toBe(method);
    expect(missingMetaKeys(params)).toEqual([]);
    expect(record(params._meta)[REQUIRED_META_KEYS[0]]).toBe(PROTOCOL_VERSION);
    expect(record(record(params._meta)[REQUIRED_META_KEYS[1]])).toEqual({});
  });

  it('flags a request that omits a required _meta key', () => {
    const params = record(readFixture('tools-list.request.json').params);
    const meta = { ...record(params._meta) };
    delete meta[REQUIRED_META_KEYS[0]];
    delete meta[REQUIRED_META_KEYS[1]];

    expect(missingMetaKeys({ _meta: meta })).toEqual([...REQUIRED_META_KEYS]);
  });
});

describe('MCP 2026-07-28 tools/list result fixture', () => {
  const result = record(readFixture('tools-list.result.json').result);

  it('is a complete, cacheable result', () => {
    expect(result.resultType).toBe('complete');
    expect(
      Number.isInteger(result.ttlMs) && (result.ttlMs as number) >= 0
    ).toBe(true);
    expect(['public', 'private']).toContain(result.cacheScope);
    expect(readFixture('tools-list.result.json').id).toBe(
      readFixture('tools-list.request.json').id
    );
  });

  it('lists search_ucp_catalog with an object input schema', () => {
    const tools = (result.tools as JsonObject[]).map(record);

    expect(tools.map((tool) => tool.name)).toEqual(['search_ucp_catalog']);
    expect(record(tools[0].inputSchema).type).toBe('object');
    expect(record(tools[0].annotations).readOnlyHint).toBe(true);
  });
});

describe('MCP 2026-07-28 tools/call fixtures', () => {
  const request = readFixture('tools-call.search-ucp-catalog.request.json');
  const response = readFixture('tools-call.search-ucp-catalog.result.json');
  const result = record(response.result);

  it('calls a listed tool with arguments that satisfy its input schema', () => {
    const tool = record(
      (
        record(readFixture('tools-list.result.json').result).tools as unknown[]
      )[0]
    );
    const params = record(request.params);

    const validate = new Ajv2020().compile(record(tool.inputSchema));

    expect(params.name).toBe(tool.name);
    expect(validate(params.arguments)).toBe(true);
    expect(validate({ limit: 0 })).toBe(false);
    expect(validate({ limit: 51 })).toBe(false);
  });

  it('completes with text content and structured content', () => {
    const structured = record(result.structuredContent);

    expect(response.id).toBe(request.id);
    expect(result.resultType).toBe('complete');
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([
      { type: 'text', text: 'UCP catalog search completed.' },
    ]);
    expect(structured.status).toBe('success');
  });

  it('carries a UCP catalog search response in minor units', () => {
    const { catalog } = record(result.structuredContent);

    expect(
      validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, catalog)
    ).toEqual({ errors: [], valid: true });
  });
});

describe('known gaps against MCP 2026-07-28', () => {
  // Roadmap Task 5 moves the card to 2026-07-28; this test then starts
  // failing and `.fails` must go. The server card still says 2025-06-18.
  it.fails('F40: the server card advertises MCP 2026-07-28', async () => {
    const { GET } = await import(
      '@/app/.well-known/mcp/server-card.json/route'
    );

    const body = await GET().json();

    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
