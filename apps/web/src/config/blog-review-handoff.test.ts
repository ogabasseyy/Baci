import { describe, expect, it } from 'vitest';
import {
  MAX_REVIEW_HANDOFF_CONTENT_LENGTH,
  MAX_REVIEW_HANDOFF_FILE_SIZE,
} from './blog-review-handoff';

describe('blog review handoff limits', () => {
  it('caps article HTML at one million characters', () => {
    expect(MAX_REVIEW_HANDOFF_CONTENT_LENGTH).toBe(1_000_000);
  });

  it('caps handoff files at decimal 2 MB', () => {
    expect(MAX_REVIEW_HANDOFF_FILE_SIZE).toBe(2_000_000);
  });
});
