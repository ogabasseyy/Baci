import {
  createBuilderAccountResolver,
  createBuilderUserClientResolver,
} from '@/lib/builder-connector/account-linking';
import { builderError } from '@/lib/builder-connector/errors';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { applyStorefrontOperation } from '@/lib/website-builder/apply-edit';
import { createStorefrontDraftService } from '@/lib/website-builder/create-draft';
import { DraftServiceError } from '@/lib/website-builder/mutation-authorization';
import { queueStorefrontEdit } from '@/lib/website-builder/queue-edit';
import { getStorefrontOperation } from '@/lib/website-builder/read-operation';
import {
  createListStorefrontsService,
  getStorefrontStatus,
} from '@/lib/website-builder/read-storefront';
import type { ImplementedBuilderTool } from '@/schemas/builder-implemented-tools';
import { builderInputSchemas } from '@/schemas/builder-mcp';
export function createBuilderServiceDispatcher(
  deps: Parameters<typeof createBuilderUserClientResolver>[0]
) {
  const rawUserClient = createBuilderUserClientResolver(deps);
  const resolveUserClient: typeof rawUserClient = async (identity) => {
    try {
      return await rawUserClient(identity);
    } catch {
      throw new DraftServiceError('CONNECTION_REVOKED');
    }
  };
  const resolveAccount = createBuilderAccountResolver(deps);
  const list = createListStorefrontsService({ resolveUserClient });
  const create = createStorefrontDraftService({ resolveUserClient });
  return async (
    identity: BuilderIdentity,
    tool: ImplementedBuilderTool,
    input: unknown
  ) => {
    if (tool === 'list_storefronts')
      return list(identity, builderInputSchemas.list_storefronts.parse(input));
    if (tool === 'create_storefront_draft')
      return create(
        identity,
        builderInputSchemas.create_storefront_draft.parse(input)
      );
    const parsed = builderInputSchemas[tool].parse(input);
    let ctx: Awaited<ReturnType<typeof resolveAccount>>;
    try {
      ctx = await resolveAccount(identity, parsed.storefrontId, tool);
    } catch (error) {
      throw new DraftServiceError(
        error instanceof Error && error.message === 'Storefront not found.'
          ? 'NOT_FOUND'
          : 'CONNECTION_REVOKED'
      );
    }
    if (tool === 'get_storefront_status') return getStorefrontStatus(ctx);
    if (tool === 'get_storefront_operation')
      return getStorefrontOperation(
        ctx,
        builderInputSchemas.get_storefront_operation.parse(input).operationId
      );
    // Do not silently adapt custom/registry templates or unsupported private blocks.
    if (!(await getStorefrontStatus(ctx)).capabilities.supported)
      return builderError('UNSUPPORTED_TEMPLATE');
    if (tool === 'update_storefront_draft')
      return queueStorefrontEdit(
        ctx,
        builderInputSchemas.update_storefront_draft.parse(input)
      );
    return applyStorefrontOperation(
      ctx,
      builderInputSchemas.apply_storefront_operation.parse(input)
    );
  };
}
