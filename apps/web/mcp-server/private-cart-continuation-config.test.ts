import { expect, it } from 'vitest';
import { privateCartContinuationEnabled } from './private-cart-continuation-config';
it.each([undefined, '', 'false', 'TRUE', '1'])('keeps candidate disabled for %s', (value) => {
  expect(privateCartContinuationEnabled({ BACI_MCP_PRIVATE_TEXT_CONTINUATION: value })).toBe(false);
});
it('allows a QA deployment to explicitly enable the candidate', () => {
  expect(privateCartContinuationEnabled({ BACI_MCP_PRIVATE_TEXT_CONTINUATION: 'true' })).toBe(true);
});
