import type { BuilderScope } from '@/schemas/builder-tool-names';
import type { ExperienceToolName } from '@/schemas/experience-tools';

function policy(scope: BuilderScope, mutation: boolean) {
  const scopes: BuilderScope[] =
    scope === 'storefront.read' ? [scope] : ['storefront.read', scope];
  return {
    scopes,
    securitySchemes: [{ type: 'oauth2' as const, scopes }],
    annotations: {
      readOnlyHint: !mutation,
      destructiveHint: false,
      idempotentHint: !mutation,
      openWorldHint: false,
    },
  };
}
export const experienceToolPolicy = {
  get_experience_capabilities: policy('storefront.read', false),
  read_experience: policy('storefront.write', true),
  begin_experience_upload: policy('storefront.write', true),
  write_experience_chunk: policy('storefront.write', true),
  finalize_experience_upload: policy('storefront.write', true),
  build_experience: policy('storefront.write', true),
  get_experience_operation: policy('storefront.read', false),
  read_experience_performance: policy('storefront.read', false),
  finalize_experience_build: policy('storefront.write', true),
  preview_experience: policy('storefront.write', true),
  apply_experience: policy('storefront.write', true),
  publish_experience: policy('storefront.publish', true),
  rollback_experience: policy('storefront.publish', true),
  read_experience_evidence: policy('storefront.read', false),
} satisfies Record<ExperienceToolName, ReturnType<typeof policy>>;
