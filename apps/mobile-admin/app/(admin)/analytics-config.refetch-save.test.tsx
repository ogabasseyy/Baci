import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsConfigScreen,
  alertMocks,
  merchantAnalytics,
  mutationMocks,
  queryClientMocks,
  queryMocks,
  readinessMocks,
  resetAnalyticsConfigMocks,
  routeMocks,
  supabaseMocks,
} from '../../__tests__/admin/analytics-config.test-support';

const expandMetaCard = () =>
  fireEvent.click(
    screen.getByText('Meta (Facebook/Instagram)').closest('button') as Element
  );
const changePixel = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('1234567890123456'), {
    target: { value },
  });
const queryOptions = () =>
  queryMocks.useQuery.mock.calls.at(-1)?.[0] as {
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
  };

describe('AnalyticsConfigScreen — post-save readiness', () => {
  beforeEach(resetAnalyticsConfigMocks);

  it('runs mocked mutation success and settlement callbacks', async () => {
    const onError = vi.fn();
    const onSettled = vi.fn();
    const onSuccess = vi.fn();
    const onMutate = vi.fn(() => ({ source: 'test' }));
    const mutationFn = vi.fn(async () => 'saved');
    const { mutate } = mutationMocks.useMutation({
      mutationFn,
      onError,
      onMutate,
      onSettled,
      onSuccess,
    });

    mutate('value');

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('saved', 'value', {
        source: 'test',
      });
      expect(onSettled).toHaveBeenCalledWith('saved', null, 'value', {
        source: 'test',
      });
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('runs mocked mutation error and settlement callbacks without rejecting', async () => {
    const failure = new Error('save failed');
    const onError = vi.fn();
    const onSettled = vi.fn();
    const { mutate } = mutationMocks.useMutation({
      mutationFn: async () => {
        throw failure;
      },
      onError,
      onSettled,
    });

    mutate('value');

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure, 'value', undefined);
      expect(onSettled).toHaveBeenCalledWith(null, failure, 'value', undefined);
    });
  });

  it('marks the saved buffer clean so refetching resumes and repeated saves do not rewrite the same fields', async () => {
    const { rerender } = render(<AnalyticsConfigScreen />);
    expandMetaCard();
    changePixel('EDITED-PIXEL-123');
    rerender(<AnalyticsConfigScreen />);
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    await mutationMocks.state.options?.mutationFn();
    await act(async () => {
      await mutationMocks.state.options?.onSuccess?.();
    });
    queryMocks.useQuery.mockReturnValue({
      data: {
        analytics: {
          ...merchantAnalytics,
          facebook_pixel_id: 'EDITED-PIXEL-123',
        },
        isOwner: true,
      },
      isError: false,
      isLoading: false,
    });
    rerender(<AnalyticsConfigScreen />);
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    });
    await mutationMocks.state.options?.mutationFn();
    expect(supabaseMocks.update).toHaveBeenCalledTimes(1);
    expect(queryClientMocks.setQueryData).toHaveBeenCalled();
  });

  it('keeps edits made while a save is pending dirty after the save succeeds', async () => {
    const { rerender } = render(<AnalyticsConfigScreen />);
    expandMetaCard();
    changePixel('SAVED-PIXEL-123');
    const saved = await mutationMocks.state.options?.mutationFn();
    changePixel('PENDING-PIXEL-456');
    await act(async () => {
      await mutationMocks.state.options?.onSuccess?.(saved);
    });
    rerender(<AnalyticsConfigScreen />);
    expect(
      (screen.getByPlaceholderText('1234567890123456') as HTMLInputElement)
        .value
    ).toBe('PENDING-PIXEL-456');
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });

  it('snapshots the saved analytics and reports success after a save so the post-save buffer is clean', async () => {
    render(<AnalyticsConfigScreen />);
    expandMetaCard();
    changePixel('EDITED-PIXEL-123');
    await mutationMocks.state.options?.mutationFn();
    await act(async () => {
      await mutationMocks.state.options?.onSuccess?.();
    });
    expect(alertMocks.alert).toHaveBeenCalledWith(
      'Success',
      'Analytics settings saved!',
      expect.any(Array)
    );
    await mutationMocks.state.options?.mutationFn();
    expect(supabaseMocks.update).toHaveBeenCalledTimes(1);
  });

  it('waits for readiness invalidation before showing analytics save success', async () => {
    let release!: () => void;
    readinessMocks.invalidateStoreReadiness.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    render(<AnalyticsConfigScreen />);
    const completion = mutationMocks.state.options?.onSuccess?.({
      ...merchantAnalytics,
    });
    await Promise.resolve();
    expect(alertMocks.alert).not.toHaveBeenCalled();
    release();
    await completion;
    expect(alertMocks.alert).toHaveBeenCalledWith(
      'Success',
      'Analytics settings saved!',
      expect.any(Array)
    );
  });

  it('reports analytics save success when the post-save readiness refresh rejects', async () => {
    readinessMocks.invalidateStoreReadiness.mockRejectedValueOnce(
      new Error('readiness unavailable')
    );
    render(<AnalyticsConfigScreen />);
    await act(async () => {
      await mutationMocks.state.options?.onSuccess?.({ ...merchantAnalytics });
    });
    expect(alertMocks.alert).toHaveBeenCalledWith(
      'Success',
      'Analytics settings saved!',
      expect.any(Array)
    );
  });

  it('returns to the checklist without a success alert after a checklist analytics save', async () => {
    routeMocks.params = { from: 'setup' };
    render(<AnalyticsConfigScreen />);
    await act(async () => {
      await mutationMocks.state.options?.onSuccess?.({ ...merchantAnalytics });
    });
    expect(routeMocks.back).toHaveBeenCalledTimes(1);
    expect(alertMocks.alert).not.toHaveBeenCalled();
  });

  it('refreshes the saved merchant cache when the user returns after switching away', async () => {
    routeMocks.params = { from: 'setup' };
    render(<AnalyticsConfigScreen />);
    const context = await mutationMocks.state.options?.onMutate?.();
    // Simulate switching merchants while the first merchant's write is in flight.
    const { accessMocks } = await import(
      '../../__tests__/admin/analytics-config.test-support'
    );
    accessMocks.useMerchant.mockReturnValue({
      isLoading: false,
      merchant: { id: 'merchant-2', plan_tier: 'pro', premium_features: [] },
    });
    render(<AnalyticsConfigScreen />);
    await mutationMocks.state.options?.onSuccess?.(
      { ...merchantAnalytics },
      undefined,
      context
    );
    expect(queryClientMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant-analytics-full', 'user-1', 'merchant-1'],
    });
    expect(readinessMocks.invalidateStoreReadiness).toHaveBeenCalledWith(
      queryClientMocks,
      'merchant-1'
    );
    expect(queryClientMocks.setQueryData).not.toHaveBeenCalled();
  });
});
