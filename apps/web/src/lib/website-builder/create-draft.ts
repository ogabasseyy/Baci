import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  builderInputSchemas,
  type CreateDraftInput,
} from '@/schemas/builder-mcp';
import { builderDraftResultSchema } from '@/schemas/builder-mcp-results';
import type { DraftServiceDependencies } from './context';
import { createPrivateHome } from './create-private-home';
import { parseDraftRetryKey } from './idempotency';
import {
  DraftServiceError,
  requireBuilderScope,
  safeDatabaseFailure,
} from './mutation-authorization';
export function createStorefrontDraftService(deps: DraftServiceDependencies) {
  return async function createStorefrontDraft(
    identity: BuilderIdentity,
    input: CreateDraftInput
  ) {
    requireBuilderScope(identity, 'storefront.write');
    if (!identity.allowCreateStore)
      throw new DraftServiceError('INSUFFICIENT_SCOPE');
    const { idempotencyKey, ...semantic } =
      builderInputSchemas.create_storefront_draft.parse(input);
    const client = await deps.resolveUserClient(identity);
    const { data, error } = await client.rpc('builder_create_draft', {
      p_connection: identity.connectionId,
      p_version: identity.grantVersion,
      p_retry_key: parseDraftRetryKey(idempotencyKey),
      p_input: semantic,
      p_config: createPrivateHome(semantic.businessName),
    });
    if (error) safeDatabaseFailure(error);
    return builderDraftResultSchema.parse(data);
  };
}
