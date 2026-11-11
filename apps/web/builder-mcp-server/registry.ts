import type { McpServer } from '@modelcontextprotocol/server';
import { builderError } from '../src/lib/builder-connector/errors';
import { builderToolPolicy } from '../src/lib/builder-connector/tool-policy';
import { experienceToolPolicy } from '../src/lib/experience/tool-policy';
import { implementedBuilderTools } from '../src/schemas/builder-implemented-tools';
import type { ConnectorToolName } from '../src/schemas/connector-tool-names';
import { experienceToolNames } from '../src/schemas/experience-tools';
import {
  builderSdkOutputSchema,
  builderWireInputs,
  listedBuilderSchemas,
} from './contracts';
import {
  experienceSdkOutputSchema,
  experienceWireInputs,
  listedExperienceSchemas,
} from './experience-contracts';
import { createExperienceEvidenceClient } from './experience-evidence-client';
import { experienceToolDescriptions } from './experience-metadata';
import { experienceMcpToolResult } from './experience-tool-result';
import { builderToolDescriptions } from './metadata';
import { builderPreviewToolMeta } from './preview-resource';
import { builderToolResult } from './tool-result';
export interface BuilderMcpDependencies {
  /** Request-local outer resource token. Never an upstream Supabase token or MCP session ID. */
  bearerToken?: string;
  experience?: {
    enabled: true;
    readImage?: ReturnType<typeof createExperienceEvidenceClient>;
  };

  signal?: AbortSignal;
  executeBuilderTool: (
    bearerToken: string,
    tool: ConnectorToolName,
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
  if (deps.experience?.enabled)
    for (const name of experienceToolNames) {
      const policy = experienceToolPolicy[name];
      server.registerTool(
        name,
        {
          ...experienceToolDescriptions[name],
          inputSchema: experienceWireInputs[name],
          outputSchema: experienceSdkOutputSchema(),
          annotations: policy.annotations,
          _meta: { securitySchemes: policy.securitySchemes },
        },
        async (input: unknown) => {
          if (!deps.bearerToken)
            return experienceMcpToolResult(name, {
              status: 'error',
              code: 'CONNECTION_REVOKED',
              error: 'Experience request unavailable.',
            });
          try {
            const result = await deps.executeBuilderTool(
              deps.bearerToken,
              name,
              input,
              deps.signal
            );
            const evidenceId =
              typeof input === 'object' &&
              input !== null &&
              'evidenceId' in input &&
              typeof input.evidenceId === 'string'
                ? input.evidenceId
                : undefined;
            return experienceMcpToolResult(name, result, {
              token: deps.bearerToken,
              evidenceId,
              readImage:
                deps.experience?.readImage ?? createExperienceEvidenceClient(),
              signal: deps.signal,
            });
          } catch {
            return experienceMcpToolResult(name, {
              status: 'error',
              code: 'UNAVAILABLE',
              error: 'Experience request unavailable.',
            });
          }
        }
      );
    }
  // SDK2.3.1 carries extensions in _meta but omits unknown top-level config fields.
  // Mirror the same schema/policy metadata at the wire level for OpenAI discovery.
  server.server.setRequestHandler('tools/list', async () => ({
    tools: [
      ...implementedBuilderTools.map((name) => ({
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
      ...(deps.experience?.enabled
        ? experienceToolNames.map((name) => ({
            name,
            ...experienceToolDescriptions[name],
            ...listedExperienceSchemas(name),
            annotations: experienceToolPolicy[name].annotations,
            securitySchemes: experienceToolPolicy[name].securitySchemes,
            _meta: {
              securitySchemes: experienceToolPolicy[name].securitySchemes,
            },
          }))
        : []),
    ],
  }));
}
