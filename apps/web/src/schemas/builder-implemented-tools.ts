/** Only implemented handlers are discoverable. Publication requests require separate owner approval. */
export const implementedBuilderTools = [
  'list_storefronts',
  'get_storefront_status',
  'create_storefront_draft',
  'update_storefront_draft',
  'get_storefront_operation',
  'apply_storefront_operation',
  'preview_storefront',
  'publish_storefront',
] as const;
export type ImplementedBuilderTool = (typeof implementedBuilderTools)[number];
export function isImplementedBuilderTool(
  value: string
): value is ImplementedBuilderTool {
  return (implementedBuilderTools as readonly string[]).includes(value);
}
