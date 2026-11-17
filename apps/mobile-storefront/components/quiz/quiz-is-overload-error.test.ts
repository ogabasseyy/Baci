import { isOverloadError } from './quiz-is-overload-error';

describe('isOverloadError', () => {
  it('recognises rate limiting and overload by status', () => {
    expect(isOverloadError({ status: 429 })).toBe(true);
    expect(
      isOverloadError(Object.assign(new Error('busy'), { status: 503 }))
    ).toBe(true);
  });

  it('ignores other failures', () => {
    expect(isOverloadError({ status: 500 })).toBe(false);
    expect(isOverloadError(new Error('offline'))).toBe(false);
    expect(isOverloadError(null)).toBe(false);
    expect(isOverloadError('503')).toBe(false);
  });
});
