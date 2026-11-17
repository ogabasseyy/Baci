import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  TRACKING_EXPLAINER_DELAY_MS,
  useAppTrackingTransparency,
} from './use-app-tracking-transparency';
import {
  mockCanRequestTrackingTransparency,
  mockGetTrackingPermissionStatus,
  mockRecordCrashBreadcrumb,
  mockRequestTrackingPermission,
  mockTrackEvent,
  primeAttTrackingMocks,
} from './use-app-tracking-transparency.test-utils';

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
  gatherConsentBeforeTracking: async () => 'skipped',
}));

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let flush = 0; flush < 10; flush += 1) {
      await Promise.resolve();
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flushPromises();
}

describe('bugfix: Apple tracking prompt covered the launch animation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    primeAttTrackingMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the explainer after the launch delay and holds Apple prompt until Continue', async () => {
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true, explainFirst: true })
    );
    await flushPromises();

    expect(result.current.explainer.visible).toBe(false);
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();

    await advance(TRACKING_EXPLAINER_DELAY_MS);
    expect(result.current.explainer.visible).toBe(true);
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'ATT Explainer Shown',
      undefined
    );

    await act(async () => {
      result.current.explainer.onContinue();
    });
    await flushPromises();

    expect(result.current.explainer.visible).toBe(false);
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(result.current.isTrackingAuthorizationSettled).toBe(true);
  });

  it('never shows the explainer when the shopper already decided', async () => {
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'denied' });
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true, explainFirst: true })
    );
    await flushPromises();
    await advance(TRACKING_EXPLAINER_DELAY_MS);

    expect(result.current.explainer.visible).toBe(false);
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
    expect(result.current.isTrackingAuthorizationSettled).toBe(true);
  });

  it('hides the explainer and asks nothing when the coordinator is disabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAppTrackingTransparency({ enabled, explainFirst: true }),
      { initialProps: { enabled: true } }
    );
    await flushPromises();
    await advance(TRACKING_EXPLAINER_DELAY_MS);
    expect(result.current.explainer.visible).toBe(true);

    rerender({ enabled: false });
    await flushPromises();

    expect(result.current.explainer.visible).toBe(false);
    await act(async () => {
      result.current.explainer.onContinue();
    });
    expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
  });

  it('keeps the old direct request when no explainer is asked for', async () => {
    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushPromises();

    expect(result.current.explainer.visible).toBe(false);
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
  });
});
