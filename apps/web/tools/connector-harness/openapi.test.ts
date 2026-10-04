import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_MANIFEST,
  CONNECTOR_MANIFEST_VERSION,
} from '../../src/lib/connector/manifest';
import { buildOpenApiDocument } from './openapi';

describe('buildOpenApiDocument', () => {
  it('exposes every manifest tool with its exact input schema', () => {
    const document = buildOpenApiDocument('http://127.0.0.1:3101');

    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(CONNECTOR_MANIFEST_VERSION);
    expect(Object.keys(document.paths).sort()).toEqual(
      CONNECTOR_MANIFEST.map((tool) => `/v0/tools/${tool.name}`).sort()
    );

    for (const tool of CONNECTOR_MANIFEST) {
      const path = document.paths[`/v0/tools/${tool.name}`] as {
        post: {
          operationId: string;
          security: Record<string, string[]>[];
          requestBody: {
            content: { 'application/json': { schema: unknown } };
          };
        };
      };
      expect(path.post.operationId).toBe(tool.name);
      expect(path.post.security).toEqual([{ connectorToken: [] }]);
      expect(path.post.requestBody.content['application/json'].schema).toEqual(
        tool.inputSchema
      );
    }
  });

  it('declares bearer token security', () => {
    const document = buildOpenApiDocument('https://staging.example');
    expect(document.servers).toEqual([{ url: 'https://staging.example' }]);
    expect(document.components.securitySchemes.connectorToken.scheme).toBe(
      'bearer'
    );
  });
});
