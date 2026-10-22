export const BUILDER_RESOURCE = 'https://mcp.usebaci.com/builder/mcp';
export const BUILDER_ISSUER = 'https://auth.usebaci.com';
export const BUILDER_METADATA_PATH =
  '/.well-known/oauth-protected-resource/builder/mcp';
export const builderProtectedResource = {
  resource: BUILDER_RESOURCE,
  authorization_servers: [BUILDER_ISSUER],
  scopes_supported: [
    'storefront.read',
    'storefront.write',
    'storefront.publish',
  ],
  bearer_methods_supported: ['header'],
};
export const builderToolDescriptions = {
  list_storefronts: {
    title: 'List Baci stores',
    description:
      'List the owned store explicitly linked to this Baci connection. Returns no unconsented store.',
  },
  get_storefront_status: {
    title: 'Read Baci storefront status',
    description:
      'Read the current draft revision, pending edits and supported capabilities of the linked store. Does not run or apply edits.',
  },
  create_storefront_draft: {
    title: 'Create a private Baci store draft',
    description:
      'Create or complete an owned private store with explicit create consent. Does not publish. Keep the same retry key when reconciling an uncertain result.',
  },
  update_storefront_draft: {
    title: 'Queue a Baci homepage edit',
    description:
      'Queue a natural-language change to the current supported homepage revision. Produces an operation, not a live website change. Poll the operation before applying.',
  },
  get_storefront_operation: {
    title: 'Read a Baci edit operation',
    description:
      'Read the safe status of a queued edit. Polling never generates, applies or publishes changes.',
  },
  apply_storefront_operation: {
    title: 'Apply a ready Baci draft edit',
    description:
      'Validate and apply a ready operation to its exact source draft revision. Does not publish. Reuse the retry key after an uncertain result.',
  },
} as const;
