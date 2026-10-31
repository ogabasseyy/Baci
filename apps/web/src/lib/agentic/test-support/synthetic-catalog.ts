import type { GPTLineItem } from '@/lib/agentic/checkout';
import type {
  AgenticProduct,
  AgenticVariant,
} from '@/lib/agentic/checkout-catalog';
import type { UcpCatalogProductRow } from '@/lib/agentic/ucp-catalog-adapters';
import { syntheticUuid } from './synthetic-ids';
import type { SyntheticMerchant } from './synthetic-merchants';

type SyntheticCondition = NonNullable<GPTLineItem['item']['condition']>;

type SyntheticStockState = 'in_stock' | 'out_of_stock' | 'unknown';

export const SYNTHETIC_PRODUCT_SCENARIOS = [
  'kobo_price',
  'refurbished',
  'out_of_stock_variant',
  'unknown_stock_variant',
] as const;

type SyntheticProductScenario = (typeof SYNTHETIC_PRODUCT_SCENARIOS)[number];

interface SyntheticProduct {
  readonly condition: SyntheticCondition;
  /** Storefront price in major units, as stored (for example 39.98). */
  readonly priceMajor: number;
  /** The same price in minor units (for example 3998). */
  readonly priceMinor: number;
  /** What the checkout quote reads for the parent product. */
  readonly product: AgenticProduct;
  /** What the UCP catalog adapters read for the parent product. */
  readonly row: UcpCatalogProductRow;
  readonly scenario: SyntheticProductScenario;
  /**
   * `unknown` means the merchant does not track stock (`manage_stock` is
   * null), which the storefront contract treats as available without a count.
   */
  readonly stockState: SyntheticStockState;
  /** The variant the scenario is about, or null for a plain product. */
  readonly variant: AgenticVariant | null;
}

export type SyntheticCatalog = Readonly<
  Record<SyntheticProductScenario, SyntheticProduct>
>;

interface ProductSpec {
  condition: SyntheticCondition;
  manageStock: boolean | null;
  name: string;
  priceMajor: number;
  priceMinor: number;
  scenario: SyntheticProductScenario;
  stock: number;
  stockState: SyntheticStockState;
  variant: { attributes: Record<string, string>; stockQuantity: number } | null;
}

const SPECS: readonly ProductSpec[] = [
  {
    condition: 'new',
    manageStock: true,
    name: 'Kobo phone',
    priceMajor: 39.98,
    priceMinor: 3998,
    scenario: 'kobo_price',
    stock: 25,
    stockState: 'in_stock',
    variant: null,
  },
  {
    condition: 'refurbished',
    manageStock: true,
    name: 'Refurbished laptop',
    priceMajor: 1250.5,
    priceMinor: 125050,
    scenario: 'refurbished',
    stock: 2,
    stockState: 'in_stock',
    variant: null,
  },
  {
    condition: 'new',
    manageStock: true,
    name: 'Two-colour speaker',
    priceMajor: 82.5,
    priceMinor: 8250,
    scenario: 'out_of_stock_variant',
    // Every variant is sold out, so the parent has nothing to sell either.
    stock: 0,
    stockState: 'out_of_stock',
    variant: { attributes: { colour: 'Black' }, stockQuantity: 0 },
  },
  {
    condition: 'new',
    manageStock: null,
    name: 'Untracked tee',
    priceMajor: 15.5,
    priceMinor: 1550,
    scenario: 'unknown_stock_variant',
    stock: 0,
    stockState: 'unknown',
    variant: { attributes: { size: 'M' }, stockQuantity: 0 },
  },
];

function buildProduct(
  merchant: SyntheticMerchant,
  spec: ProductSpec,
  index: number
): SyntheticProduct {
  const productId = syntheticUuid(merchant.idNamespace, 100 + index * 10);
  const slug = spec.name.toLowerCase().replaceAll(' ', '-');
  const variant: AgenticVariant | null = spec.variant
    ? {
        attributes: spec.variant.attributes,
        id: syntheticUuid(merchant.idNamespace, 100 + index * 10 + 1),
        merchant_id: merchant.context.id,
        product: {
          manage_stock: spec.manageStock,
          name: spec.name,
          price: spec.priceMajor,
        },
        product_id: productId,
        stock_quantity: spec.variant.stockQuantity,
      }
    : null;
  return {
    condition: spec.condition,
    priceMajor: spec.priceMajor,
    priceMinor: spec.priceMinor,
    product: {
      id: productId,
      manage_stock: spec.manageStock,
      name: spec.name,
      price: spec.priceMajor,
      stock: spec.stock,
      stock_quantity: spec.stock,
    },
    row: {
      id: productId,
      manage_stock: spec.manageStock,
      merchant_id: merchant.context.id,
      name: spec.name,
      price: spec.priceMajor,
      slug,
      status: 'active',
      stock: spec.stock,
      stock_quantity: spec.stock,
    },
    scenario: spec.scenario,
    stockState: spec.stockState,
    variant,
  };
}

/** The same four scenarios for any merchant, under that merchant's ids. */
export function buildSyntheticCatalog(
  merchant: SyntheticMerchant
): SyntheticCatalog {
  return Object.fromEntries(
    SPECS.map((spec, index) => [
      spec.scenario,
      buildProduct(merchant, spec, index),
    ])
  ) as SyntheticCatalog;
}
