import { expect, it } from 'vitest';
import { setup } from './edit-service.test-support';
import {
  requireBuilderScope,
  safeDatabaseFailure,
} from './mutation-authorization';

it('requires the exact granted scope', () => {
  const { ctx } = setup(null);
  expect(() =>
    requireBuilderScope(ctx.identity, 'storefront.read')
  ).not.toThrow();
  expect(() => requireBuilderScope(ctx.identity, 'storefront.publish')).toThrow(
    expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' })
  );
});
it('maps only exact public database errors and redacts provider details', () => {
  expect(() => safeDatabaseFailure({ message: 'NOT_FOUND' })).toThrow(
    expect.objectContaining({ code: 'NOT_FOUND' })
  );
  expect(() =>
    safeDatabaseFailure({ message: 'NOT_FOUND: secret tenant SQL' })
  ).toThrow(expect.objectContaining({ code: 'OPERATION_FAILED' }));
});
