/**
 * Get the recommended template ID for a specific business type
 */
export function getTemplateIdByBusinessType(businessType?: string): string {
  if (!businessType) return 'electronics';

  const normalized = businessType.toUpperCase();

  switch (normalized) {
    case 'ELECTRONICS':
    case 'GADGETS':
      return 'electronics';
    case 'FASHION':
      return 'fashion';
    case 'HOME_GOODS':
      return 'home-goods';
    case 'FOOD_BEVERAGE':
      return 'food-beverage';
    case 'HEALTH_BEAUTY':
      return 'health-beauty';
    case 'HAIR_EXTENSIONS':
      return 'hair-extensions';
    case 'PHARMACEUTICALS':
      return 'pharmaceuticals';
    case 'HANDMADE':
      return 'handmade';
    default:
      return 'electronics';
  }
}

/**
 * Resolves the server-rendered storefront template. A null result means the
 * client-only Puck storefront is the active homepage source.
 */
export function resolveStorefrontTemplateId(
  templateId?: string | null,
  businessType?: string | null
): string | null {
  const resolvedTemplateId =
    templateId && templateId !== 'default'
      ? templateId
      : getTemplateIdByBusinessType(businessType ?? undefined);

  return resolvedTemplateId === 'puck' ? null : resolvedTemplateId;
}
