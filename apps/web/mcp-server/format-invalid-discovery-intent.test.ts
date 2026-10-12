import { expect, it } from 'vitest';
import { formatInvalidDiscoveryIntent } from './format-invalid-discovery-intent';

it.each(['Search intent is required.', 'Invalid search intent: empty alternative.'])('marks the handler rejection as an MCP tool failure: %s', (message) => {
  expect(formatInvalidDiscoveryIntent(message)).toEqual({
    isError: true, content: [{ type: 'text', text: message }],
    structuredContent: { products: [], status: 'error', message },
  });
});
