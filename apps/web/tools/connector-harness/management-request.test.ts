import { expect, it } from 'vitest';
import { handleManagementRequest } from './management-request';
import { makeRequestContext } from './request-context.test-support';

it.each([
  '/v0/issue-token',
  '/v0/revoke',
])('requires owner authentication for %s', async (path) => {
  const context = makeRequestContext(path);
  expect(await handleManagementRequest(context)).toBe(true);
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    401,
    'Not authorized.'
  );
  expect(context.sql).not.toHaveBeenCalled();
});
it('leaves unrelated routes to the server dispatcher', async () => {
  const context = makeRequestContext('/other');
  expect(await handleManagementRequest(context)).toBe(false);
  expect(context.sendError).not.toHaveBeenCalled();
});
