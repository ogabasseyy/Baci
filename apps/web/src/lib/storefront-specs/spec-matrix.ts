import type { ProductSpecSection } from './spec-data';
import { buildProductSpecData } from './spec-data';
import type { ComparableProductKeySpecs } from './spec-taxonomy';
import type { VariantAttributeSource } from './variant-attributes';

export interface MatrixProductInput {
  id: string | number;
  name: string;
  brand?: string | null;
  category?: string | null;
  condition?: string | null;
  description?: string | null;
  detailedSpecs?:
    | ReturnType<typeof buildProductSpecData>['detailedSpecs']
    | null;
  product_key_specs?: ComparableProductKeySpecs | null;
  specifications?:
    | { category: string; items: { label: string; value: string }[] }[]
    | null;
  specs?: { label: string; value: string }[] | string | null;
  variant_attributes?: VariantAttributeSource;
}

export interface ProductComparisonMatrixColumn {
  productId: string;
  label: string;
}

export interface ProductComparisonMatrixRow {
  label: string;
  values: string[];
  isDifferent: boolean;
}

export interface ProductComparisonMatrixGroup {
  category: string;
  rows: ProductComparisonMatrixRow[];
}

export interface ProductComparisonMatrix {
  columns: ProductComparisonMatrixColumn[];
  groups: ProductComparisonMatrixGroup[];
  flatRows: ProductComparisonMatrixRow[];
  differentiatingRowCount: number;
}

function indexDetailedSpecs(input: ProductSpecSection[]) {
  const categoryItems = new Map<string, Map<string, string>>();

  for (const section of input) {
    // Match the former Array.find behavior: only the first section with a
    // category contributes values when legacy input repeats that category.
    if (categoryItems.has(section.category)) {
      continue;
    }

    const items = new Map<string, string>();
    for (const item of section.items) {
      // Match the former item Array.find behavior for duplicate labels.
      if (!items.has(item.label)) {
        items.set(item.label, item.value);
      }
    }
    categoryItems.set(section.category, items);
  }

  return categoryItems;
}

export function buildProductComparisonMatrix(input: {
  products: MatrixProductInput[];
}): ProductComparisonMatrix {
  const specData = input.products.map((product) =>
    buildProductSpecData(product)
  );
  const categoryNames: string[] = [];
  const categoryLabels = new Map<string, string[]>();
  const categoryLabelSets = new Map<string, Set<string>>();
  const indexedSpecData = specData.map((entry) => {
    const categoryItems = indexDetailedSpecs(entry.detailedSpecs);

    for (const [category, items] of categoryItems) {
      if (!categoryLabels.has(category)) {
        categoryNames.push(category);
        categoryLabels.set(category, []);
        categoryLabelSets.set(category, new Set());
      }

      const labels = categoryLabels.get(category);
      const seenLabels = categoryLabelSets.get(category);
      if (!labels || !seenLabels) {
        continue;
      }

      for (const label of items.keys()) {
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          labels.push(label);
        }
      }
    }

    return categoryItems;
  });

  const groups = categoryNames
    .map((category) => {
      const labels = categoryLabels.get(category) ?? [];

      const rows = labels.map((label) => {
        const values = indexedSpecData.map(
          (categoryItems) => categoryItems.get(category)?.get(label) || '—'
        );
        const presentValues = values.filter((value) => value !== '—');
        const uniquePresentValues = new Set(presentValues);

        return {
          label,
          values,
          isDifferent:
            uniquePresentValues.size > 1 ||
            (presentValues.length > 0 && values.includes('—')),
        };
      });

      return { category, rows };
    })
    .filter((group) => group.rows.length > 0);

  const flatRows = groups.flatMap((group) => group.rows);

  return {
    columns: input.products.map((product) => ({
      productId: String(product.id),
      label: product.name,
    })),
    groups,
    flatRows,
    differentiatingRowCount: flatRows.filter((row) => row.isDifferent).length,
  };
}
