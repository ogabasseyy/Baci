import {
  buildUcpCatalogProductsResponse,
  mapUcpCatalogProductRow,
  UCP_CATALOG_SEARCH_CAPABILITY,
} from '@/lib/agentic/ucp-catalog-adapters';
import { MAJOR_PRICE } from './ucp-conformance-data';

const PRODUCT_ROW = {
  description: 'A phone priced with kobo',
  id: 'product-1',
  manage_stock: true,
  merchant_id: 'merchant-1',
  name: 'Kobo phone',
  price: MAJOR_PRICE,
  slug: 'kobo-phone',
  status: 'active',
  stock: 3,
};

export function searchResponse() {
  const product = mapUcpCatalogProductRow({
    baseUrl: 'https://ogabassey.com',
    currency: 'NGN',
    row: PRODUCT_ROW,
  });
  if (!product) throw new Error('Expected the product row to map');
  return {
    product,
    response: buildUcpCatalogProductsResponse({
      capability: UCP_CATALOG_SEARCH_CAPABILITY,
      products: [product],
    }),
  };
}
