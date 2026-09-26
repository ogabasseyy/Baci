import { describe, expect, it } from 'vitest';
import { JumiaPartialUpdateError } from './jumia-partial-update-error';

describe('JumiaPartialUpdateError', () => {
  it('carries the accepted feed ids for reconciliation', () => {
    const error = new JumiaPartialUpdateError('Local save failed.', ['feed-1']);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JumiaPartialUpdateError');
    expect(error.message).toBe('Local save failed.');
    expect(error.feedIds).toEqual(['feed-1']);
  });
});
