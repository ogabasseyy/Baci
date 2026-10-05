import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_MANIFEST,
  CONNECTOR_MANIFEST_VERSION,
} from '../../src/lib/connector/manifest';
import { buildGatewayOpenApiDocument } from './openapi';

describe('buildGatewayOpenApiDocument', () => {
  it('advertises the stable base address and manifest tool contract', () => {
    const document = buildGatewayOpenApiDocument(
      'https://connector.staging.example.com'
    );

    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(CONNECTOR_MANIFEST_VERSION);
    expect(document.servers).toEqual([
      { url: 'https://connector.staging.example.com' },
    ]);

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

  it('exposes only the four tool paths, never credential endpoints', () => {
    const document = buildGatewayOpenApiDocument('https://example.com');

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v0/tools/analytics.summary',
      '/v0/tools/inventory.levels',
      '/v0/tools/orders.get',
      '/v0/tools/orders.list',
    ]);
    for (const path of ['/v0/issue-token', '/v0/refresh', '/v0/revoke']) {
      expect(document.paths[path]).toBeUndefined();
    }
    expect('ownerSecret' in document.components.securitySchemes).toBe(false);
    expect(
      document.components.securitySchemes.connectorToken.description
    ).toContain('Baci Dashboard');
  });
});
