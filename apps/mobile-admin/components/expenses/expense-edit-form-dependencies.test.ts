import { describe, expect, it } from 'vitest';
import {
  dependencyErrorMessage,
  isFatalDependencyError,
} from './expense-edit-form-dependencies';

describe('isFatalDependencyError', () => {
  it('treats dependency errors as fatal only without cached data', () => {
    const error = new Error('network offline');

    expect(isFatalDependencyError(error, false)).toBe(true);
    expect(isFatalDependencyError(error, true)).toBe(false);
    expect(isFatalDependencyError(null, false)).toBe(false);
  });
});

describe('dependencyErrorMessage', () => {
  it('prefers the branch error message', () => {
    expect(
      dependencyErrorMessage(
        new Error('branches unavailable'),
        new Error('groups unavailable')
      )
    ).toBe('Could not load branches. Please try again.');
  });
});
