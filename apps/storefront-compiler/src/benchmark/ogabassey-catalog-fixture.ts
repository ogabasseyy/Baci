export { createOgabasseyStorefrontManifest } from './ogabassey-storefront-manifest';

export interface BackingCatalogVariant {
  id: string;
  sku: string;
  label: string;
  storage: string;
  color: string;
  priceNgn: number;
  /** Sensitive merchant-only field — must NEVER appear in public projection! */
  costPriceNgn: number;
  stockQty: number;
}

export interface BackingCatalogProduct {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  brand: string;
  condition: 'New' | 'Open Box' | 'UK Used';
  priceNgn: number;
  /** Sensitive merchant-only fields — must NEVER appear in public projection! */
  costPriceNgn: number;
  supplierInternalCode: string;
  isPublished: boolean;
  imageUrl: string;
  imageAlt: string;
  shortSpecs: string;
  variants: BackingCatalogVariant[];
}

export interface PublicProjectedVariant {
  id: string;
  label: string;
  storage: string;
  color: string;
  priceNgn: number;
  inStock: boolean;
}

export interface PublicProjectedProduct {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  brand: string;
  condition: 'New' | 'Open Box' | 'UK Used';
  priceNgn: number;
  inStock: boolean;
  imageUrl: string;
  imageAlt: string;
  shortSpecs: string;
  variants: PublicProjectedVariant[];
}

const CATEGORIES = [
  { slug: 'smartphones', name: 'Smartphones' },
  { slug: 'laptops', name: 'Laptops' },
  { slug: 'gaming', name: 'Gaming Consoles' },
  { slug: 'tablets', name: 'Tablets' },
  { slug: 'audio', name: 'Headphones & Audio' },
  { slug: 'accessories', name: 'Chargers & Accessories' },
] as const;

const BRANDS = [
  'Apple',
  'Samsung',
  'Tecno',
  'Infinix',
  'HP',
  'Sony',
  'Xiaomi',
  'Lenovo',
] as const;

const CONDITIONS: readonly ('New' | 'Open Box' | 'UK Used')[] = [
  'New',
  'Open Box',
  'UK Used',
];

const MODEL_SERIES = [
  'iPhone 16 Pro Max',
  'Galaxy S25 Ultra',
  'Camon 40 Premier',
  'MacBook Pro M4',
  'PlayStation 5 Pro',
  'iPad Pro M4',
  'WH-1000XM6',
  'Redmi Note 14 Pro',
] as const;

const STORAGES = ['128GB', '256GB', '512GB', '1TB'] as const;
const COLORS = ['Obsidian', 'Titanium', 'Silver', 'Cobalt'] as const;

export function generateOgabasseyBackingCatalog(
  productCount = 2000
): BackingCatalogProduct[] {
  const products: BackingCatalogProduct[] = [];
  for (let i = 0; i < productCount; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const brand = BRANDS[i % BRANDS.length];
    const series = MODEL_SERIES[i % MODEL_SERIES.length];
    const condition = CONDITIONS[i % CONDITIONS.length];
    const basePrice = 185_000 + ((i * 37_500) % 2_450_000);
    const slug = `${brand.toLowerCase()}-${series
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-${i + 1}`;
    const variants: BackingCatalogVariant[] = [0, 1].map((vIdx) => {
      const variantPrice = basePrice + vIdx * 95_000;
      const storage = STORAGES[(i + vIdx) % STORAGES.length];
      const color = COLORS[(i + vIdx) % COLORS.length];
      return {
        id: `var_${i + 1}_${vIdx + 1}`,
        sku: `OGA-${i + 1}-${vIdx + 1}`,
        label: `${storage} / ${color}`,
        storage,
        color,
        priceNgn: variantPrice,
        costPriceNgn: Math.round(variantPrice * 0.78),
        stockQty: (i + vIdx) % 9 === 0 ? 0 : ((i * 3 + vIdx) % 24) + 1,
      };
    });

    products.push({
      id: `prod_${i + 1}`,
      slug,
      name: `${brand} ${series} (${condition}) #${i + 1}`,
      categorySlug: category.slug,
      categoryName: category.name,
      brand,
      condition,
      priceNgn: basePrice,
      costPriceNgn: Math.round(basePrice * 0.78),
      supplierInternalCode: `SUP-LAGOS-${(i % 17) + 100}`,
      isPublished: i % 47 !== 46,
      imageUrl: `https://cdn.usebaci.com/ogabassey/${slug}.webp`,
      imageAlt: `${brand} ${series} ${condition} front view`,
      shortSpecs: 'OLED 120Hz, 5G Dual SIM, Official Warranty',
      variants,
    });
  }
  return products;
}
