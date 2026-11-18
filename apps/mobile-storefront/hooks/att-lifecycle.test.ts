import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { isDenialUnrecorded, recordAttLifecycleEvent } from './att-lifecycle';

const mockRecordCrashBreadcrumb = jest.fn();
const mockTrackEvent = jest.fn();
const mockGetTrackingPermissionStatus =
  jest.fn<() => Promise<{ status: string }>>();

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: (...args: unknown[]) =>
    mockRecordCrashBreadcrumb(...args),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock('@/lib/tracking-transparency', () => ({
  getTrackingPermissionStatus: () => mockGetTrackingPermissionStatus(),
}));

describe('att-lifecycle helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('swallows breadcrumb and analytics errors when recording lifecycle events', () => {
    mockRecordCrashBreadcrumb.mockImplementation(() => {
      throw new Error('crash unavailable');
    });
    mockTrackEvent.mockImplementation(() => {
      throw new Error('analytics unavailable');
    });

    expect(() =>
      recordAttLifecycleEvent('ATT Status Checked', 'att:status_checked', {
        status: 'undetermined',
      })
    ).not.toThrow();
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Status Checked', {
      status: 'undetermined',
    });
  });

  it('returns true when denial leaves status undetermined and null when recheck fails', async () => {
    mockGetTrackingPermissionStatus.mockResolvedValueOnce({
      status: 'undetermined',
    });
    await expect(isDenialUnrecorded()).resolves.toBe(true);

    mockGetTrackingPermissionStatus.mockResolvedValueOnce({ status: 'denied' });
    await expect(isDenialUnrecorded()).resolves.toBe(false);

    mockGetTrackingPermissionStatus.mockRejectedValueOnce(new Error('fail'));
    await expect(isDenialUnrecorded()).resolves.toBeNull();
  });
});
