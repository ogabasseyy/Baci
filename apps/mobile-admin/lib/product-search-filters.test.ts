import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EFFECTIVE_IN_STOCK_FILTER,
  applyAdminProductStockAndVisibilityFilter,
  applyAdminProductStockFilter,
} from './product-search-filters';

function createQuery() {
  const query = {
    eq: vi.fn(),
    or: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  return query;
}

describe('admin product search filters', () => {
  it('combines visibility and stock alternatives into one OR-of-ANDs filter', () => {
    const query = createQuery();

    applyAdminProductStockAndVisibilityFilter(query, 'in_stock');

    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      'and(status.neq.archived,stock_quantity.gt.0),and(status.neq.archived,stock_quantity.is.null,stock.gt.0),and(status.neq.archived,stock_quantity.lte.0,stock.gt.0),and(status.is.null,stock_quantity.gt.0),and(status.is.null,stock_quantity.is.null,stock.gt.0),and(status.is.null,stock_quantity.lte.0,stock.gt.0)'
    );
  });

  it('keeps standalone stock filtering unchanged when visibility is not requested', () => {
    const query = createQuery();

    applyAdminProductStockFilter(query, 'in_stock');

    expect(query.or).toHaveBeenCalledWith(ADMIN_EFFECTIVE_IN_STOCK_FILTER);
  });
});
