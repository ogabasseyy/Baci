import { describe, expect, it } from 'vitest';
import { getJumiaSaveErrorMessage } from './get-jumia-save-error-message';
import { JumiaPartialUpdateError } from './jumia-partial-update-error';

describe('getJumiaSaveErrorMessage', () => {
  it('appends the accepted feed ids for partial failures', () => {
    expect(
      getJumiaSaveErrorMessage(
        new JumiaPartialUpdateError('Local save failed.', ['feed-1', 'feed-2'])
      )
    ).toBe('Local save failed. (Jumia feed: feed-1, feed-2)');
  });

  it('omits the feed suffix when no ids were returned', () => {
    expect(
      getJumiaSaveErrorMessage(new JumiaPartialUpdateError('Failed.', []))
    ).toBe('Failed.');
  });

  it('passes through generic errors and unknown values', () => {
    expect(getJumiaSaveErrorMessage(new Error('Server error'))).toBe(
      'Server error'
    );
    expect(getJumiaSaveErrorMessage(null)).toBe('Unknown error');
  });
});
