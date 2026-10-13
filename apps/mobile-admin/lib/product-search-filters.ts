export type AdminProductStockFilter = 'in_stock' | 'low_stock' | 'out_of_stock';

type AdminProductFilterAlternative = readonly string[];

const ADMIN_EFFECTIVE_IN_STOCK_ALTERNATIVES = [
  ['stock_quantity.gt.0'],
  ['stock_quantity.is.null', 'stock.gt.0'],
  ['stock_quantity.lte.0', 'stock.gt.0'],
] as const;
const ADMIN_EFFECTIVE_LOW_STOCK_ALTERNATIVES = [
  ['stock_quantity.gt.0', 'stock_quantity.lte.5'],
  ['stock_quantity.is.null', 'stock.gt.0', 'stock.lte.5'],
  ['stock_quantity.lte.0', 'stock.gt.0', 'stock.lte.5'],
] as const;
const ADMIN_EFFECTIVE_OUT_OF_STOCK_ALTERNATIVES = [
  ['stock_quantity.is.null', 'stock.is.null'],
  ['stock_quantity.is.null', 'stock.lte.0'],
  ['stock_quantity.lte.0', 'stock.is.null'],
  ['stock_quantity.lte.0', 'stock.lte.0'],
] as const;
const ADMIN_EFFECTIVE_STOCK_ALTERNATIVES: Record<
  AdminProductStockFilter,
  readonly AdminProductFilterAlternative[]
> = {
  in_stock: ADMIN_EFFECTIVE_IN_STOCK_ALTERNATIVES,
  low_stock: ADMIN_EFFECTIVE_LOW_STOCK_ALTERNATIVES,
  out_of_stock: ADMIN_EFFECTIVE_OUT_OF_STOCK_ALTERNATIVES,
};
const ADMIN_SEARCH_VISIBLE_STATUS_ALTERNATIVES = [
  ['status.neq.archived'],
  ['status.is.null'],
] as const;

function buildAdminProductOrFilter(
  alternatives: readonly AdminProductFilterAlternative[]
) {
  return alternatives
    .map((alternative) =>
      alternative.length === 1
        ? alternative[0]
        : `and(${alternative.join(',')})`
    )
    .join(',');
}

export const ADMIN_EFFECTIVE_IN_STOCK_FILTER = buildAdminProductOrFilter(
  ADMIN_EFFECTIVE_IN_STOCK_ALTERNATIVES
);
export const ADMIN_EFFECTIVE_LOW_STOCK_FILTER = buildAdminProductOrFilter(
  ADMIN_EFFECTIVE_LOW_STOCK_ALTERNATIVES
);
export const ADMIN_EFFECTIVE_OUT_OF_STOCK_FILTER = buildAdminProductOrFilter(
  ADMIN_EFFECTIVE_OUT_OF_STOCK_ALTERNATIVES
);

function getAdminProductStockAlternatives(
  stockFilter: AdminProductStockFilter | undefined
) {
  return stockFilter ? ADMIN_EFFECTIVE_STOCK_ALTERNATIVES[stockFilter] : null;
}

type ProductFilterQuery<TQuery> = {
  eq: (column: string, value: unknown) => TQuery;
  or: (filters: string) => TQuery;
};

export function applyAdminProductStockFilter<
  TQuery extends ProductFilterQuery<TQuery>,
>(query: TQuery, stockFilter: AdminProductStockFilter | undefined): TQuery {
  const stockAlternatives = getAdminProductStockAlternatives(stockFilter);
  return stockAlternatives
    ? query
        .eq('manage_stock', true)
        .or(buildAdminProductOrFilter(stockAlternatives))
    : query;
}

export function applyAdminProductStockAndVisibilityFilter<
  TQuery extends ProductFilterQuery<TQuery>,
>(query: TQuery, stockFilter: AdminProductStockFilter): TQuery {
  const stockAlternatives = ADMIN_EFFECTIVE_STOCK_ALTERNATIVES[stockFilter];
  const combinedAlternatives = ADMIN_SEARCH_VISIBLE_STATUS_ALTERNATIVES.flatMap(
    (statusAlternative) =>
      stockAlternatives.map((stockAlternative) => [
        ...statusAlternative,
        ...stockAlternative,
      ])
  );

  return query
    .eq('manage_stock', true)
    .or(buildAdminProductOrFilter(combinedAlternatives));
}
