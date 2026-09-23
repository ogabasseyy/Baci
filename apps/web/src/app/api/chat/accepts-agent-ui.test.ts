import { expect, it } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import { acceptsAgentUi } from './accepts-agent-ui';

it.each([
  [null, false],
  ['text/plain', false],
  [storefrontAgentUiContract.mediaType, true],
  [`${storefrontAgentUiContract.mediaType}; q=0, text/plain`, false],
  [`text/plain, ${storefrontAgentUiContract.mediaType}; q=0.5`, true],
  [`${storefrontAgentUiContract.mediaType}; q=invalid`, false],
])('honors explicit agent UI negotiation %s', (accept, expected) => {
  const request = new Request('https://example.com', {
    headers: accept ? { accept } : {},
  });
  expect(acceptsAgentUi(request)).toBe(expected);
});
