import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useAppTrackingTransparency } from './use-app-tracking-transparency';
import {
  attAppStateMock,
  mockCanRequestTrackingTransparency,
  mockGetTrackingPermissionStatus,
  mockRecordCrashBreadcrumb,
  mockRequestTrackingPermission,
  mockTrackEvent,
  primeAttTrackingMocks,
} from './use-app-tracking-transparency.test-utils';

const mockGatherConsentBeforeTracking = jest.fn<() => Promise<string>>();

jest.mock('@/lib/tracking-transparency', () => ({
  canRequestTrackingTransparency: () => mockCanRequestTrackingTransparency(),
  getTrackingPermissionStatus: () => mockGetTrackingPermissionStatus(),
}));

jest.mock('@/services/ad-tracking', () => ({
  requestTrackingPermission: () => mockRequestTrackingPermission(),
}));

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: (...args: unknown[]) =>
    mockRecordCrashBreadcrumb(...args),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock('@/services/consent-before-tracking', () => ({
  gatherConsentBeforeTracking: () => mockGatherConsentBeforeTracking(),
}));

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let flush = 0; flush < 10; flush += 1) {
      await Promise.resolve();
    }
  });
}

describe('bugfix: the tracking prompt fired before the consent message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    primeAttTrackingMocks();
    mockGatherConsentBeforeTracking.mockReset();
    mockGatherConsentBeforeTracking.mockResolvedValue('done');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('holds the tracking prompt until the consent step finishes', async () => {
    let finishConsent: (outcome: string) => void = () => undefined;
    mockGatherConsentBeforeTracking.mockReturnValue(
      new Promise<string>((resolve) => {
        finishConsent = resolve;
      })
    );
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushPromises();

    expect(mockGatherConsentBeforeTracking).toHaveBeenCalledTimes(1);
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
    expect(result.current.isTrackingAuthorizationSettled).toBe(false);

    await act(async () => {
      finishConsent('done');
    });

    await waitFor(() => {
      expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Consent Gate', {
      outcome: 'done',
      appStateBeforeConsent: AppState.currentState ?? 'unknown',
    });
  });

  it.each([
    'timeout',
    'error',
  ])('still asks for tracking when the consent step ends in %s', async (outcome) => {
    mockGatherConsentBeforeTracking.mockResolvedValue(outcome);
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );

    await waitFor(() => {
      expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Consent Gate', {
      outcome,
      appStateBeforeConsent: AppState.currentState ?? 'unknown',
    });
  });

  it('asks for tracking without a consent event when ads are off', async () => {
    mockGatherConsentBeforeTracking.mockResolvedValue('skipped');
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );

    await waitFor(() => {
      expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'ATT Consent Gate',
      expect.anything()
    );
  });

  it('does not run the consent step for a shopper who already decided', async () => {
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'denied' });
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );

    await waitFor(() => {
      expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    });
    expect(mockGatherConsentBeforeTracking).not.toHaveBeenCalled();
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
  });

  it('waits for the app to be active again after the consent message', async () => {
    // The consent message can leave the app inactive for a moment; the
    // request must still go through the active-state wait.
    attAppStateMock.current = 'inactive';
    renderHook(() => useAppTrackingTransparency({ enabled: true }));
    await flushPromises();

    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();

    attAppStateMock.current = 'active';
    await act(async () => {
      attAppStateMock.listener?.('active');
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
  });

  it('does not ask for tracking when unmounted during the consent step', async () => {
    let finishConsent: (outcome: string) => void = () => undefined;
    mockGatherConsentBeforeTracking.mockReturnValue(
      new Promise<string>((resolve) => {
        finishConsent = resolve;
      })
    );
    const { unmount } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushPromises();

    unmount();
    await act(async () => {
      finishConsent('done');
    });
    await flushPromises();

    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
  });
});
