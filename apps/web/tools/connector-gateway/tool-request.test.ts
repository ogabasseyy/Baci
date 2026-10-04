import { expect, it } from 'vitest';
import { makeRequestContext } from './request-context.test-support';
import { handleToolRequest } from './tool-request';

it('rejects an unknown tool before reading its body or accessing the database', async () => {
  const context = makeRequestContext('/v0/tools/unknown');
  await handleToolRequest(context, 'unknown');
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    404,
    'Unknown connector tool.',
    'INVALID_REQUEST'
  );
  expect(context.sql).not.toHaveBeenCalled();
});
it('requires a bearer credential for a known tool', async () => {
  const context = makeRequestContext('/v0/tools/orders.list');
  await handleToolRequest(context, 'orders.list');
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    401,
    expect.any(String),
    'GRANT_REVOKED'
  );
  expect(context.sql).not.toHaveBeenCalled();
});
