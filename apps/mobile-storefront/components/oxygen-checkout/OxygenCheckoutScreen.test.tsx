import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { OxygenClientError } from '@/services/oxygen/errors';
import {
  OxygenCheckoutScreen,
  readOwnedOxygenOrder,
  resetWorkflowUnmounts,
  router,
  savedCheckoutFixture,
  setCheckoutFocused,
  useOxygenWorkflow,
  workflowUnmountCount,
} from './OxygenCheckoutScreen.test-utils';

describe('saved native Oxygen checkout', () => {
  const { capabilities, refresh } = savedCheckoutFixture();
  it('stops the workflow when this checkout route is no longer focused', async () => {
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('Saved workflow');
    act(() => {
      setCheckoutFocused(false);
    });
    expect(screen.queryByText('Saved workflow')).toBeNull();
    act(() => {
      setCheckoutFocused(true);
    });
    await screen.findByText('Saved workflow');
  });
  it('does not add a manual update checkpoint after selfie confirmation', async () => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: {
        stage: 'eligibility_required',
        state: {
          validated: true,
          kyc: {
            phone_status: 'DONE',
            bvn_status: 'DONE',
            selfie_status: 'DONE',
          },
        },
      },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('Saved workflow');
    expect(screen.queryByText('Check for an update')).toBeNull();
    expect(screen.queryByText('Check eligibility')).toBeNull();
  });
  it('keeps compact payment content near the top instead of centering it', async () => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'payment_required', state: {} },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    render(<OxygenCheckoutScreen orderId="order" />);
    const content = await screen.findByText('Saved workflow');
    let ancestor = content.parent;
    while (ancestor && !ancestor.props.style?.justifyContent) {
      ancestor = ancestor.parent;
    }
    expect(ancestor?.props.style.justifyContent).toBe('flex-start');
  });
  it('keeps read-only recovery available after a disconnected verification screen', async () => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: {
        stage: 'kyc_required',
        state: {
          validated: true,
          kyc: {
            phone_status: 'DONE',
            bvn_status: 'DONE',
            selfie_status: 'DONE',
          },
        },
      },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: new Error('Connection lost'),
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('We couldn’t confirm this step');
    expect(screen.getByText('Check for an update')).toBeTruthy();
  });
  it('replaces booking actions with one recovery footer while preserving the selected plan', async () => {
    const state = {
      snapshot: { stage: 'plan_required', state: { validated: true } },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: new Error('Unconfirmed booking') as Error | null,
      refresh,
    };
    let update: (next: ReturnType<typeof useOxygenWorkflow>) => void = () =>
      undefined;
    jest.mocked(useOxygenWorkflow).mockImplementation(() => {
      const [current, setCurrent] = useState({
        ...state,
        error: null,
      } as unknown as ReturnType<typeof useOxygenWorkflow>);
      update = setCurrent;
      return current;
    });
    resetWorkflowUnmounts();
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('See payment breakdown');
    act(() => update(state as unknown as ReturnType<typeof useOxygenWorkflow>));
    await screen.findByText('We couldn’t confirm this step');
    expect(screen.queryByText('See payment breakdown')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Check for an update' })
    ).toHaveLength(1);
    fireEvent.press(
      screen.getByRole('button', { name: 'Check for an update' })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await act(async () => {});
    act(() =>
      update({ ...state, error: null } as unknown as ReturnType<
        typeof useOxygenWorkflow
      >)
    );
    await screen.findByText('See payment breakdown');
    expect(
      screen.queryByRole('button', { name: 'Check for an update' })
    ).toBeNull();
    expect(workflowUnmountCount()).toBe(0);
  });
  it('keeps a recovery action when refreshing saved progress loses capabilities', async () => {
    let refreshedCapabilities: { mobileEnabled: boolean } | null = null;
    const state = {
      snapshot: { stage: 'plan_required', state: {} },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      refresh,
    };
    jest.mocked(useOxygenWorkflow).mockImplementation(() => {
      const [error, setError] = useState<Error | null>(
        () => new Error('Connection lost')
      );
      refresh.mockImplementation(async () => {
        if (refresh.mock.calls.length > 1)
          refreshedCapabilities = { mobileEnabled: false };
        setError(null);
      });
      return {
        ...state,
        error,
        capabilities: refreshedCapabilities,
      } as unknown as ReturnType<typeof useOxygenWorkflow>;
    });
    capabilities.mockResolvedValueOnce({ mobileEnabled: false });
    render(<OxygenCheckoutScreen orderId="order" />);
    const retry = await screen.findByRole('button', {
      name: 'Check for an update',
    });
    await act(async () => fireEvent.press(retry));
    expect(screen.queryByText('See payment breakdown')).toBeNull();
    expect(screen.getByText('Oxygen is temporarily unavailable')).toBeTruthy();
    await act(async () =>
      fireEvent.press(
        screen.getByRole('button', { name: 'Check for an update' })
      )
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('See payment breakdown')).toBeTruthy();
  });
  it('shows the saved workflow when its controller recovers the initial capability read', async () => {
    capabilities.mockRejectedValueOnce(new OxygenClientError('transport'));
    render(<OxygenCheckoutScreen orderId="order" />);
    expect(await screen.findByText('Saved workflow')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('keeps plan selection to one primary action without a duplicate update button', async () => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'plan_required', state: { validated: true } },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('Saved workflow');
    expect(screen.queryByText('Check for an update')).toBeNull();
  });
  it('resumes the same owned order when new initiation is disabled and checkpoint does not route to success', async () => {
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('Saved workflow');
    expect(
      screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps
    ).toBe('handled');
    expect(screen.UNSAFE_getByType(ScrollView).props.nestedScrollEnabled).toBe(
      true
    );
    expect(capabilities).toHaveBeenCalledWith(false);
    expect(readOwnedOxygenOrder).toHaveBeenCalledWith(
      'order',
      'customer',
      'merchant'
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { stage: 'ready_for_activation' },
  ])('hides recovery controls while progress is loading: %j', async (snapshot) => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot,
      controller: snapshot ? {} : null,
      busy: true,
      error: null,
      refresh: jest.fn(),
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    render(<OxygenCheckoutScreen orderId="order" />);
    await waitFor(() => expect(readOwnedOxygenOrder).toHaveBeenCalled());
    expect(screen.queryByText('Check for an update')).toBeNull();
    if (!snapshot)
      expect(
        await screen.findByLabelText('Loading your application')
      ).toBeTruthy();
  });
});
