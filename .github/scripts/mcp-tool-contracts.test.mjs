import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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


test('production smoke watches and runs the extracted contract tests', () => {
  const workflow = readFileSync(new URL('../workflows/mcp-production-smoke.yml', import.meta.url), 'utf8');
  const paths = workflow.split('  schedule:')[0];
  const command = workflow.split('run: node --test ')[1]?.split('\n')[0];
  assert.ok(command);
  for (const name of ['mcp-tool-inventory', 'mcp-checkout-tool-schema-contracts']) {
    assert.ok(paths.includes(`.github/scripts/${name}.*`));
    assert.ok(command.includes(`.github/scripts/${name}.test.mjs`));
  }
});


test('production smoke ignores stale repository tool overrides', () => {
  const workflow = readFileSync(new URL('../workflows/mcp-production-smoke.yml', import.meta.url), 'utf8');
  const matches = [...workflow.matchAll(/^\s*MCP_REQUIRED_TOOLS:\s*(.*)$/gm)];
  assert.ok(matches.length > 0, 'expected an MCP_REQUIRED_TOOLS env entry');
  for (const match of matches) {
    assert.equal(match[1].trim(), '""');
  }
  assert.equal(workflow.includes('${{ vars.MCP_REQUIRED_TOOLS'), false);
});
