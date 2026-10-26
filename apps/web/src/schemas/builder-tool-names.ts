/** Dependency-free names/scopes shared by discovery and the authenticated web boundary. */
export const builderToolNames = [
  'list_storefronts',
  'get_storefront_status',
  'create_storefront_draft',
  'update_storefront_draft',
  'get_storefront_operation',
  'apply_storefront_operation',
  'preview_storefront',
  'publish_storefront',
] as const;
export type BuilderToolName = (typeof builderToolNames)[number];
export type BuilderScope =
  | 'storefront.read'
  | 'storefront.write'
  | 'storefront.publish';
