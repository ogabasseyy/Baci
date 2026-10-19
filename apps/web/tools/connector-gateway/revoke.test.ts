import { expect, it } from 'vitest';
import { makeRequestContext } from './request-context.test-support';
import { handleRevoke } from './revoke';

it('keeps the staging credential endpoint inaccessible in production', async () => {
  const context = makeRequestContext('/v0/revoke');
  await handleRevoke(context);
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
