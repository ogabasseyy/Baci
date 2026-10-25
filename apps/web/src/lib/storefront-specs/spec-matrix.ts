import {
  COMPARISON_CONFLICT_PREFIX,
  isDocumentedComparisonValue,
  normalizeComparisonLabel,
  normalizeComparisonValue,
} from './comparison-spec-semantics';
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

const CANONICAL_SPEC_CATEGORIES: Record<string, string> = {
  'Water and dust resistance': 'Body',
  'Refresh Rate': 'Display',
  Storage: 'Memory',
  'CPU / GPU': 'Platform',
};

function indexDetailedSpecs(input: ProductSpecSection[]) {
  const valuesByCategory = new Map<string, Map<string, Map<string, string>>>();
  for (const section of input) {
    for (const item of section.items) {
      const label = normalizeComparisonLabel(item.label);
      const category = CANONICAL_SPEC_CATEGORIES[label] ?? section.category;
      const items =
        valuesByCategory.get(category) ??
        new Map<string, Map<string, string>>();
      const distinctValues = items.get(label) ?? new Map<string, string>();
      const normalizedValue = normalizeComparisonValue(item.value);
      if (!distinctValues.has(normalizedValue)) {
        distinctValues.set(normalizedValue, item.value);
      }
      items.set(label, distinctValues);
      valuesByCategory.set(category, items);
    }
  }

  // Serialize only after collection so subsequent aliases are compared with
  // source values, never with an already formatted conflict message.
  return new Map(
    [...valuesByCategory].map(([category, items]) => [
      category,
      new Map(
        [...items].map(([label, distinctValues]) => {
          const values = [...distinctValues.values()];
          return [
            label,
            values.length > 1
              ? `${COMPARISON_CONFLICT_PREFIX}${values.join('; ')}`
              : (values[0] ?? 'Not documented'),
          ];
        })
      ),
    ])
  );
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
          (categoryItems) =>
            categoryItems.get(category)?.get(label) || 'Not documented'
        );
        const presentValues = values.filter(isDocumentedComparisonValue);
        const uniquePresentValues = new Set(
          presentValues.map((value) =>
            label === 'Refresh Rate'
              ? (value.match(/\d+(?:\.\d+)?(?=\s*hz)/i)?.[0] ??
                normalizeComparisonValue(value))
              : normalizeComparisonValue(value)
          )
        );

        return {
          label,
          values,
          isDifferent:
            presentValues.length === values.length &&
            uniquePresentValues.size > 1,
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
