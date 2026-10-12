import { expect, it } from 'vitest';
import { handleIssueToken } from './issue-token';
import { makeRequestContext } from './request-context.test-support';

it('keeps the staging credential endpoint inaccessible in production', async () => {
  const context = makeRequestContext('/v0/issue-token');
  await handleIssueToken(context);
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    404,
    'Not found.',
    'INVALID_REQUEST'
  );
  expect(context.sql).not.toHaveBeenCalled();
  expect(context.audit).toHaveBeenCalledWith(
    expect.objectContaining({ status: 404 })
  );
});
