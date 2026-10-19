import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS } from './mcp-checkout-tool-schema-contracts.mjs';

test('defines only the checkout session schema contracts', () => {
  assert.deepEqual(Object.keys(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS), [
    'create_agentic_checkout_session',
    'update_agentic_checkout_session',
  ]);
  assert.deepEqual(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS.create_agentic_checkout_session.required, ['items']);
  assert.deepEqual(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS.update_agentic_checkout_session.required, ['session_id']);
});
