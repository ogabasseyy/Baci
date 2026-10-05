/**
 * R1 read-only gateway discovery document.
 *
 * Builds a real OpenAPI 3.1 description from the connector manifest only:
 * the four `/v0/tools/*` paths keep their exact shapes. Credential
 * endpoints (`/v0/issue-token`, `/v0/refresh`, `/v0/revoke`) are
 * deliberately absent — they stay off the public transport (see
 * Caddyfile), and advertising them would surface unreachable owner
 * operations as agent tools. Pure: covered by unit tests.
 */

import {
  CONNECTOR_MANIFEST,
  CONNECTOR_MANIFEST_VERSION,
} from '../../src/lib/connector/manifest';

export interface GatewayOpenApiDocument {
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

function toolPaths(): Record<string, unknown> {
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
          429: { description: 'Rate limit exceeded.' },
        },
      },
    };
  }
  return paths;
}

export function buildGatewayOpenApiDocument(
  baseUrl: string
): GatewayOpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Baci Connector Gateway (read-only R1)',
      version: CONNECTOR_MANIFEST_VERSION,
    },
    servers: [{ url: baseUrl }],
    paths: {
      ...toolPaths(),
    },
    components: {
      securitySchemes: {
        connectorToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Opaque, agent-specific key created by the merchant owner in Baci Dashboard → Integrations → Muse. The key is scoped to the selected merchant, branches, and read permissions.',
        },
      },
    },
  };
}
