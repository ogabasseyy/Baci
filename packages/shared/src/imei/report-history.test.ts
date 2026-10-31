import { describe, expect, it, vi } from 'vitest';
import {
  fetchImeiReports,
  ImeiReportsResponseSchema,
  resolveImeiReportDevice,
} from './report-history';

describe('IMEI report history contract', () => {
  it('infers only unambiguous legacy categories and rejects incompatible categories', () => {
    expect(resolveImeiReportDevice('simLock', null)).toBe('smartphone');
    expect(resolveImeiReportDevice('icloud', null)).toBeNull();
    expect(resolveImeiReportDevice('simLock', 'laptop')).toBeNull();
    expect(resolveImeiReportDevice('simLock', 'smartphone')).toBe('smartphone');
  });
  it('rejects malformed report lists', () => {
    expect(
      ImeiReportsResponseSchema.safeParse({ reports: [{}], hasMore: false })
        .success
    ).toBe(false);
    expect(
      ImeiReportsResponseSchema.safeParse({ reports: [], hasMore: 'false' })
        .success
    ).toBe(false);
  });
  it('reports authentication failures without exposing the response body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('private', { status: 401 }));
    await expect(fetchImeiReports({ fetchImpl })).rejects.toThrow(
      'Sign in to view your completed reports.'
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/reports?page=0'),
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
    );
  });
  it('rejects invalid server data and handles non-authentication errors', async () => {
    await expect(
      fetchImeiReports({
        fetchImpl: vi
          .fn()
          .mockResolvedValue(Response.json({ reports: [{}], hasMore: false })),
      })
    ).rejects.toThrow();
    await expect(
      fetchImeiReports({
        fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 500 })),
      })
    ).rejects.toThrow('Unable to load reports. Please try again.');
  });
});
