import { expect, it } from 'vitest';
import { makeRequestContext } from './request-context.test-support';
import { handleToolRequest } from './tool-request';

it('denies order access without a bearer credential', async () => {
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
it('rejects an unknown operation', async () => {
  const context = makeRequestContext('/v0/tools/unknown');
  await handleToolRequest(context, 'unknown');
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    404,
    'Unknown connector tool.'
  );
});
