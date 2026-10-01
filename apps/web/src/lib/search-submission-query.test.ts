import { describe, expect, it } from 'vitest';
import {
  SEARCH_SUBMISSION_QUERY_MAX_LENGTH,
  truncateSearchSubmissionQuery,
} from './search-submission-query';

describe('truncateSearchSubmissionQuery', () => {
  it('trims and clamps to the shared limit', () => {
    expect(truncateSearchSubmissionQuery(`  ${'b'.repeat(200)}  `)).toBe(
      'b'.repeat(200)
    );
    expect(truncateSearchSubmissionQuery('a'.repeat(201)).length).toBe(
      SEARCH_SUBMISSION_QUERY_MAX_LENGTH
    );
  });

  it('drops a trailing lone surrogate instead of splitting an astral character', () => {
    expect(truncateSearchSubmissionQuery(`${'a'.repeat(199)}😀`)).toBe(
      'a'.repeat(199)
    );
  });

  it('honors an explicit limit', () => {
    expect(truncateSearchSubmissionQuery('  phone case  ', 5)).toBe('phone');
  });
});
