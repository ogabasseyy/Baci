/**
 * R0 connector harness discovery document.
 *
 * Builds a real OpenAPI 3.1 description from the connector manifest so Muse
 * (or curl) can discover the exact tool contract the harness serves. Pure:
 * covered by unit tests.
 */

import {
  CONNECTOR_MANIFEST,
  CONNECTOR_MANIFEST_VERSION,
} from '../../src/lib/connector/manifest';

export interface HarnessOpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, unknown>;
  components: {
    securitySchemes: {
      connectorToken: {
        type: 'http';
        scheme: 'bearer';
        description: string;
      };
    };
  };
}

export function buildOpenApiDocument(baseUrl: string): HarnessOpenApiDocument {
  const paths: Record<string, unknown> = {};
  for (const tool of CONNECTOR_MANIFEST) {
    paths[`/v0/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        security: [{ connectorToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: tool.inputSchema },
          },
        },
        responses: {
          200: { description: 'Tool result.' },
          400: { description: 'Invalid request body.' },
          401: { description: 'Invalid, revoked, or expired credential.' },
          403: { description: 'Scope, branch, or permission denial.' },
          404: { description: 'Unknown tool or unresolvable resource.' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Baci Connector R0 Harness',
      version: CONNECTOR_MANIFEST_VERSION,
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      securitySchemes: {
        connectorToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Opaque connector token issued by POST /v0/issue-token (test-only manual issuance).',
        },
      },
    },
  };
}
