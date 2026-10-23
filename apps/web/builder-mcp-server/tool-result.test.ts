import { expect, it } from 'vitest';
import { builderError } from '../src/lib/builder-connector/errors';
import { builderToolResult } from './tool-result';

it('formats valid results without losing structured content', () => {
  expect(
    builderToolResult('list_storefronts', { stores: [], nextCursor: null })
  ).toMatchObject({
    isError: false,
    structuredContent: { stores: [], nextCursor: null },
  });
});
it('replaces unvalidated private payloads with a safe error', () => {
  const result = builderToolResult('list_storefronts', {
    stores: [],
    nextCursor: null,
    secret: 'private SQL',
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private SQL');
  expect(result.structuredContent).toMatchObject({ code: 'OPERATION_FAILED' });
});
it('requests account relinking when authorization is revoked', () => {
  const result = builderToolResult(
    'list_storefronts',
    builderError('CONNECTION_REVOKED')
  );
  expect(result.isError).toBe(true);
  expect(result._meta).toHaveProperty('mcp/www_authenticate');
});
