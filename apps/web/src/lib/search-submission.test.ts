import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordSearchSubmission,
  truncateSearchSubmissionQuery,
} from './search-submission';

const fetchMock = vi.fn();
describe('recordSearchSubmission', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('bounds and trims the current query before sending navigation-safe telemetry', () => {
    recordSearchSubmission(`  ${'a'.repeat(101)}  `, '/ogabassey', 'navbar');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/search/submissions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'a'.repeat(100),
          pathPrefix: '/ogabassey',
          source: 'navbar',
        }),
        keepalive: true,
      }
    );
  });

  it('drops a trailing lone surrogate instead of splitting an astral character', () => {
    expect(truncateSearchSubmissionQuery(`${'a'.repeat(99)}😀`)).toBe(
      'a'.repeat(99)
    );
    expect(truncateSearchSubmissionQuery(`  ${'b'.repeat(100)}  `)).toBe(
      'b'.repeat(100)
    );
  });

  it('omits whitespace-only submissions', () => {
    recordSearchSubmission('  ', '', 'navbar');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not deduplicate intentional identical submissions', () => {
    recordSearchSubmission('phone', '', 'navbar');
    recordSearchSubmission('phone', '', 'navbar');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('absorbs a failed HTTP response without retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    recordSearchSubmission('phone', '', 'see-all');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
