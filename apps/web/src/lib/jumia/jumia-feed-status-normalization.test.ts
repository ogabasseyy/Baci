import { describe, expect, it } from 'vitest';
import {
  isAcceptedFeedStatus,
  isFailedFeedStatus,
} from './jumia-feed-status-normalization';

describe('bugfix: Jumia feed status exact matching', () => {
  it('treats successful as accepted without matching unsuccessful', () => {
    expect(isAcceptedFeedStatus('successful')).toBe(true);
    expect(isAcceptedFeedStatus('UNSUCCESSFUL')).toBe(false);
    expect(isFailedFeedStatus('UNSUCCESSFUL')).toBe(true);
    expect(isFailedFeedStatus('successful')).toBe(false);
  });
});
