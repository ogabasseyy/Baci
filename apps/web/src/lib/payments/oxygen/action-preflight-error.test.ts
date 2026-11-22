import { oxygenActionNotDispatchedCode } from '@baci/shared/oxygen';
import { expect, it } from 'vitest';
import { OxygenActionPreflightError } from './action-preflight-error';

it('exposes the shared pre-dispatch code and a saved-status recovery message', () => {
  const error = new OxygenActionPreflightError();

  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe(oxygenActionNotDispatchedCode);
  expect(error.message).toContain('Refresh the saved status');
});
