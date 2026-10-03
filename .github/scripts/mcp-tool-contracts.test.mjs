import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REQUIRED_TOOLS,
  DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
} from './mcp-tool-contracts.mjs';

test('defines the current required public MCP inventory', () => {
  assert.deepEqual(DEFAULT_REQUIRED_TOOLS, [
    'add_to_cart',
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

test('keeps checkout schema requirements scoped to the two session tools', () => {
  assert.deepEqual(Object.keys(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS), [
    'create_agentic_checkout_session',
    'update_agentic_checkout_session',
  ]);
  assert.deepEqual(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS.create_agentic_checkout_session.required, ['items']);
  assert.deepEqual(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS.update_agentic_checkout_session.required, ['session_id']);
});
