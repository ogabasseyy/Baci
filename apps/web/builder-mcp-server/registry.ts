import type { McpServer } from '@modelcontextprotocol/server';
import { builderError } from '../src/lib/builder-connector/errors';
import { builderToolPolicy } from '../src/lib/builder-connector/tool-policy';
import {
  type ImplementedBuilderTool,
  implementedBuilderTools,
} from '../src/schemas/builder-implemented-tools';
import {
  builderSdkOutputSchema,
  builderWireInputs,
  listedBuilderSchemas,
} from './contracts';
import { builderToolDescriptions } from './metadata';
import { builderPreviewToolMeta } from './preview-resource';
import { builderToolResult } from './tool-result';
export interface BuilderMcpDependencies {
  /** Request-local outer resource token. Never an upstream Supabase token or MCP session ID. */
  bearerToken?: string;
  signal?: AbortSignal;
  executeBuilderTool: (
    bearerToken: string,
    tool: ImplementedBuilderTool,
    input: unknown,
    signal?: AbortSignal
  ) => Promise<unknown>;
}
export function registerBuilderTools(
  server: McpServer,
  deps: BuilderMcpDependencies
) {
  for (const name of implementedBuilderTools) {
    const policy = builderToolPolicy[name];
    server.registerTool(
      name,
      {
        ...builderToolDescriptions[name],
        inputSchema: builderWireInputs[name],
        outputSchema: builderSdkOutputSchema(name),
        annotations: policy.annotations,
        _meta: {
          securitySchemes: policy.securitySchemes,
          ...(name === 'preview_storefront' ? builderPreviewToolMeta : {}),
        },
      },
      async (input: unknown) => {
        if (!deps.bearerToken)
          return builderToolResult(name, builderError('CONNECTION_REVOKED'));
        try {
          return builderToolResult(
            name,
            await deps.executeBuilderTool(
              deps.bearerToken,
              name,
              input,
              deps.signal
            )
          );
        } catch {
          return builderToolResult(name, builderError('OPERATION_FAILED'));
        }
      }
    );
  }
  // SDK2.3.1 carries extensions in _meta but omits unknown top-level config fields.
  // Mirror the same schema/policy metadata at the wire level for OpenAI discovery.
  server.server.setRequestHandler('tools/list', async () => ({
    tools: implementedBuilderTools.map((name) => ({
      name,
      ...builderToolDescriptions[name],
      ...listedBuilderSchemas(name),
      annotations: builderToolPolicy[name].annotations,
      securitySchemes: builderToolPolicy[name].securitySchemes,
      _meta: {
        securitySchemes: builderToolPolicy[name].securitySchemes,
        ...(name === 'preview_storefront' ? builderPreviewToolMeta : {}),
      },
    })),
  }));
}
