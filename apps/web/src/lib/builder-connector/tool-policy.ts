import { BUILDER_EDITOR_URL } from '@/schemas/builder-mcp-primitives';
import type {
  BuilderScope,
  BuilderToolName,
} from '@/schemas/builder-tool-names';
import { PORTABLE_RENDERER_VERSION } from '@/schemas/portable-storefront';
import { type BuilderErrorCode, builderError } from './errors';

function policy(scope: BuilderScope, mutation = false, publish = false) {
  const scopes: BuilderScope[] =
    scope === 'storefront.read' ? [scope] : ['storefront.read', scope];
  return {
    scopes,
    securitySchemes: [{ type: 'oauth2' as const, scopes }],
    annotations: {
      readOnlyHint: !mutation,
      destructiveHint: publish,
      idempotentHint: true,
      openWorldHint: publish,
    },
  };
}
export const builderToolPolicy = {
  list_storefronts: policy('storefront.read'),
  get_storefront_status: policy('storefront.read'),
  create_storefront_draft: policy('storefront.write', true),
  update_storefront_draft: policy('storefront.write', true),
  get_storefront_operation: policy('storefront.read'),
  apply_storefront_operation: policy('storefront.write', true),
  preview_storefront: policy('storefront.read'),
  publish_storefront: policy('storefront.publish', true, true),
} satisfies Record<BuilderToolName, ReturnType<typeof policy>>;
export function getBuilderCapabilities(
  templateId: string | null,
  rendererVersion: string | null
) {
  const shared = { templateId, rendererVersion, editorUrl: BUILDER_EDITOR_URL };
  return templateId === 'puck' && rendererVersion === PORTABLE_RENDERER_VERSION
    ? {
        ...shared,
        templateId: 'puck' as const,
        rendererVersion: PORTABLE_RENDERER_VERSION,
        supported: true as const,
        canEdit: true as const,
        canPreview: true as const,
        canPublish: true as const,
      }
    : {
        ...shared,
        supported: false as const,
        canEdit: false as const,
        canPreview: false as const,
        canPublish: false as const,
        reason: 'UNSUPPORTED_TEMPLATE' as const,
      };
}
export function builderAuthChallenge(
  code: Extract<BuilderErrorCode, 'CONNECTION_REVOKED' | 'INSUFFICIENT_SCOPE'>,
  tool: BuilderToolName
) {
  const error = builderError(code);
  const challenge = `Bearer resource_metadata="https://mcp.usebaci.com/.well-known/oauth-protected-resource/builder/mcp", error_description="Reconnect Baci or authorize the requested permissions.", error="${code === 'INSUFFICIENT_SCOPE' ? 'insufficient_scope' : 'invalid_token'}", scope="${builderToolPolicy[tool].scopes.join(' ')}"`;
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: error.error }],
    structuredContent: error,
    _meta: { 'mcp/www_authenticate': [challenge] },
  };
}
