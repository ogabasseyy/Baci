import type { IncomingMessage, ServerResponse } from 'node:http';

export function serveCatalogFixture(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (url.pathname.endsWith('/rest/v1/products')) {
      if (url.searchParams.get('id') === 'eq.available-product') {
        response.end(JSON.stringify({ id: 'available-product', name: 'Test Phone', slug: 'test-phone', price: 100000, manage_stock: false }));
      } else if (url.searchParams.get('id') === 'eq.sold-out-product') {
        response.end(JSON.stringify({ id: 'sold-out-product', name: 'Sold Out Phone', slug: 'sold-out-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: false }));
      } else if (url.searchParams.get('id') === 'eq.variant-sold-out-product') {
        response.end(JSON.stringify({ id: 'variant-sold-out-product', name: 'Variant Sold Out Phone', slug: 'variant-sold-out-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: true }));
      } else if (url.searchParams.get('id') === 'eq.variant-available-product') {
        response.end(JSON.stringify({ id: 'variant-available-product', name: 'Variant Available Phone', slug: 'variant-available-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: true }));
      } else if (url.searchParams.get('id') === 'eq.variant-empty-product') {
        response.end(JSON.stringify({ id: 'variant-empty-product', name: 'Variant Empty Phone', slug: 'variant-empty-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: true }));
      } else if (url.searchParams.get('id') === 'eq.untracked-offer-product') {
        response.end(JSON.stringify({ id: 'untracked-offer-product', name: 'Untracked Offer Phone', slug: 'untracked-offer-phone', price: 100000, manage_stock: false, stock_quantity: 0, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.legacy-stock-product') {
        response.end(JSON.stringify({ id: 'legacy-stock-product', name: 'Legacy Stock Phone', slug: 'legacy-stock-phone', price: 100000, manage_stock: true, stock_quantity: 0, stock: 3, has_variants: false }));
      } else if (url.searchParams.get('id') === 'eq.condition-offer-product') {
        response.end(JSON.stringify({ id: 'condition-offer-product', name: 'Used Offer Phone', slug: 'used-offer-phone', price: 100000, manage_stock: true, stock_quantity: 0, stock: 0, has_variants: false, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.condition-offer-sold-out-product') {
        response.end(JSON.stringify({ id: 'condition-offer-sold-out-product', name: 'Sold Out Offer Phone', slug: 'sold-out-offer-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: false, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.condition-offer-parent-stock-product') {
        response.end(JSON.stringify({ id: 'condition-offer-parent-stock-product', name: 'Parent Stock Offer Phone', slug: 'parent-stock-offer-phone', price: 100000, manage_stock: true, stock_quantity: 2, has_variants: false, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.untracked-variant-product') {
        response.end(JSON.stringify({ id: 'untracked-variant-product', name: 'Untracked Variant Phone', slug: 'untracked-variant-phone', price: 100000, manage_stock: false, stock_quantity: 0, has_variants: true }));
      } else if (!url.searchParams.has('id') && !url.searchParams.has('name')) {
        const rows = [
          { id: 'available-product', name: 'Test Phone', slug: 'test-phone', price: 100000, compare_at_price: 120000, images: ['https://images.example.test/phone.jpg'], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'avif-product', name: 'AVIF Phone', slug: 'avif-phone', price: 120000, images: ['https://cdn.ogabassey.com/core-assets/products/redmi-15-midnight-black.avif'], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'object-image-product', name: 'Object Image Phone', slug: 'object-image-phone', price: 130000, images: [{ url: 'https://cdn.ogabassey.com/core-assets/products/redmi-15-midnight-black.avif' }], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'transformed-image-product', name: 'Transformed Image Phone', slug: 'transformed-image-phone', price: 140000, images: ['https://cdn.ogabassey.com/image/width=750/core-assets/products/phone.avif'], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'condition-offer-product', name: 'Used Offer Phone', slug: 'used-offer-phone', price: 100000, images: [], manage_stock: true, stock_quantity: 0, has_variants: false, has_condition_offers: true },
          { id: 'variant-available-product', name: 'Variant Available Phone', slug: 'variant-available-phone', price: 100000, images: [], manage_stock: true, stock_quantity: 0, has_variants: true },
          { id: 'variant-sold-out-product', name: 'Variant Sold Out Phone', slug: 'variant-sold-out-phone', price: 100000, images: [], manage_stock: true, stock_quantity: 0, has_variants: true },
          { id: 'variant-empty-product', name: 'Variant Empty Phone', slug: 'variant-empty-phone', price: 100000, images: [], manage_stock: true, stock_quantity: 0, has_variants: true },
        ];
        const isRecommendation = url.searchParams.get('select')?.includes('description,condition,brand,category,manage_stock');
        const candidates = isRecommendation
          ? [
              ...Array.from({ length: 32 }, (_, index) => index < 4
                ? {
                    id: `unrelated-available-${index}`, name: 'Other Gadget',
                    slug: `other-gadget-${index}`, price: 100000, images: [],
                    manage_stock: false, stock_quantity: 0, has_variants: false,
                  }
                : {
                    id: `sold-out-option-${index}`, name: 'Sold Out Variant Phone',
                    slug: `sold-out-option-${index}`, price: 100000, images: [],
                    manage_stock: true, stock_quantity: 0, has_variants: true,
                  }),
              ...rows,
            ]
          : rows;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? candidates.length);
        response.end(JSON.stringify(candidates.slice(offset, offset + limit)));
      } else {
        response.statusCode = 406;
        response.end(JSON.stringify({ code: 'PGRST116', message: 'No rows' }));
      }
      return true;
    }
    if (url.pathname.endsWith('/rest/v1/product_variants')) {
      response.end(JSON.stringify([{ attributes: { storage: '128GB' }, price_override: 100000, stock_quantity: 0, condition: 'new', sku: 'TEST-128' }]));
      return true;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_storefront_product_variants')) {
      const rows = [
        { product_id: 'available-product', attributes: { storage: '128GB' }, price_override: 100000, stock_quantity: 0, condition: 'new', sku: 'TEST-128' },
        { product_id: 'variant-sold-out-product', attributes: { storage: '128GB' }, stock_quantity: 0 },
        { product_id: 'variant-available-product', attributes: { storage: '256GB' }, stock_quantity: 2 },
        { product_id: 'untracked-variant-product', attributes: { storage: '128GB' }, stock_quantity: 0 },
      ];
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        const requested = JSON.parse(body) as { p_product_ids?: string[] };
        response.end(JSON.stringify(rows.filter((row) => requested.p_product_ids?.includes(row.product_id))));
      });
      return true;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_product_offers')) {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        const requested = JSON.parse(body) as { p_product_id?: string };
        response.end(JSON.stringify(requested.p_product_id === 'untracked-offer-product'
          ? [{ condition: 'used', price: 80000, stock_quantity: 0, grade: 'A', condition_notes: null }]
          : requested.p_product_id === 'condition-offer-product'
            ? [{ condition: 'used', price: 80000, stock_quantity: 2, grade: 'A', condition_notes: null }]
            : []));
      });
      return true;
    }
    if (url.pathname.endsWith('/rest/v1/product_offers')) {
      response.end(JSON.stringify(url.searchParams.get('product_id')?.includes('condition-offer-product')
        ? [{ product_id: 'condition-offer-product', stock_quantity: 2 }]
        : url.searchParams.get('product_id')?.includes('condition-offer-sold-out-product')
          ? [{ product_id: 'condition-offer-sold-out-product', stock_quantity: 0 }]
        : []));
      return true;
    }
  return false;
}
