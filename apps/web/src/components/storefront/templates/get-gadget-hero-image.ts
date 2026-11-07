export function getGadgetHeroImage(
  businessType?: string | null,
  customHeroImage?: string | null
): string {
  if (customHeroImage && customHeroImage.trim().length > 0) {
    return customHeroImage.trim();
  }
  switch (businessType) {
    case 'ELECTRONICS':
      return 'https://images.unsplash.com/photo-1498049794561-7780e7231661?q=80&w=2070&auto=format&fit=crop';
    case 'FOOD_BEVERAGE':
      return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=2070&auto=format&fit=crop';
    case 'FASHION':
      return 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?q=80&w=2070&auto=format&fit=crop';
    case 'HOME_GOODS':
      return 'https://images.unsplash.com/photo-1513584684374-8bdb74838a0f?q=80&w=2070&auto=format&fit=crop';
    case 'HEALTH_BEAUTY':
      return 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=2070&auto=format&fit=crop';
    case 'HAIR_EXTENSIONS':
      return 'https://images.unsplash.com/photo-1522337621169-d6cf09e65d95?q=80&w=2044&auto=format&fit=crop';
    default:
      return 'https://images.unsplash.com/photo-1498049794561-7780e7231661?q=80&w=2070&auto=format&fit=crop';
  }
}
