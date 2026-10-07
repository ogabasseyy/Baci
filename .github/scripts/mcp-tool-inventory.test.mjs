import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REQUIRED_TOOLS } from './mcp-tool-inventory.mjs';

test('defines the current required public MCP tool inventory', () => {
  assert.deepEqual(DEFAULT_REQUIRED_TOOLS, [
    'prepare_storefront_cart_link',
  'update_ogabassey_guest_cart',
    'browse_categories',
    'get_brands',
    'get_product',
    'get_product_variants',
    'get_delivery_fee_info',
    'get_store_info',
    'search_products',
  ]);
  assert.equal(DEFAULT_REQUIRED_TOOLS.includes('get_recommendations'), false);
  assert.equal(DEFAULT_REQUIRED_TOOLS.includes('get_shipping_quote'), false);
});
