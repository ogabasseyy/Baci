import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { readOwnedOxygenOrder } from '@/services/oxygen/owned-order';
import { OxygenCheckoutScreen } from './OxygenCheckoutScreen';
import { useOxygenWorkflow } from './use-oxygen-workflow';

let mockFocused = true;
const mockFocusSubscribers = new Set<() => void>();
jest.mock('@/components/ui/address-suggestions-portal', () => ({
  AddressSuggestionsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useIsFocused: () => {
    const { useSyncExternalStore } = require('react');
    return useSyncExternalStore(
      (listener: () => void) => {
        mockFocusSubscribers.add(listener);
        return () => mockFocusSubscribers.delete(listener);
      },
      () => mockFocused
    );
  },
}));
jest.mock('./OxygenFormPrimitives', () => ({
  ...jest.requireActual('./OxygenFormPrimitives'),
  useOxygenColors: () => ({ background: 'white', text: 'black' }),
}));
jest.mock('./oxygen-presentation', () => ({
  OxygenAction: ({ label }: { label: string }) => {
    const { Text } = require('react-native');
    return <Text>{label}</Text>;
  },
}));
let mockWorkflowUnmounts = 0;
jest.mock('./OxygenOtp', () => ({
  OxygenOtp: () => {
    const { Text } = require('react-native');
    return <Text>OTP success</Text>;
  },
}));
jest.mock('./OxygenWorkflowBody', () => ({
  OxygenWorkflowBody: ({ snapshot }: { snapshot: { stage: string } }) => {
    const { Text } = require('react-native');
    const { useEffect } = require('react');
    useEffect(
      () => () => {
        mockWorkflowUnmounts++;
      },
      []
    );
    const { OxygenActionFooter } = require('./OxygenActionFooter');
    return (
      <>
        <Text>Saved workflow</Text>
        {snapshot.stage === 'plan_required' ? (
          <OxygenActionFooter>
            <Text>See payment breakdown</Text>
          </OxygenActionFooter>
        ) : null}
      </>
    );
  },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({ user: { id: 'user' }, customer: { id: 'customer' } }),
    { getState: () => ({ customer: { id: 'customer' } }) }
  ),
}));
jest.mock('@/services/oxygen/native-session', () => ({
  oxygenNativeSession: jest.fn(),
}));
jest.mock('@/services/oxygen/owned-order', () => ({
  readOwnedOxygenOrder: jest.fn(),
}));
jest.mock('./use-oxygen-workflow', () => ({ useOxygenWorkflow: jest.fn() }));
describe('saved native Oxygen checkout', () => {
  const capabilities = jest.fn();
  const refresh = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocused = true;
    capabilities.mockResolvedValue({ mobileEnabled: false });
    jest.mocked(oxygenNativeSession).mockReturnValue({
      capabilities,
      profile: { merchantId: 'merchant' },
      workflow: jest.fn(),
      client: {},
    } as unknown as ReturnType<typeof oxygenNativeSession>);
    jest.mocked(readOwnedOxygenOrder).mockResolvedValue({
      id: 'order',
      total: 100,
      order_number: 'ORD-STAGING-1',
      payment_method: 'oxygen',
      payment_status: 'pending',
      shipping_status: 'pending',
      prefill: {},
    });
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'ready_for_activation' },
      controller: {},
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
  });
  it('stops the workflow when this checkout route is no longer focused', async () => {
    render(<OxygenCheckoutScreen orderId="order" />);
    await screen.findByText('Saved workflow');
    act(() => {
      mockFocused = false;
      mockFocusSubscribers.forEach((listener) => {
        listener();
      });
    });
    expect(screen.queryByText('Saved workflow')).toBeNull();
    act(() => {
      mockFocused = true;
      mockFocusSubscribers.forEach((listener) => {
        listener();
      });
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
      controller: {},
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
      controller: {},
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
      controller: {},
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
      controller: {},
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
    mockWorkflowUnmounts = 0;
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
    expect(mockWorkflowUnmounts).toBe(0);
  });
  it('keeps plan selection to one primary action without a duplicate update button', async () => {
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'plan_required', state: { validated: true } },
      controller: {},
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
    'unpaid',
    'bnpl_approved',
  ])('uses the owned order state after activation (%s)', async (paymentStatus) => {
    jest.mocked(readOwnedOxygenOrder).mockResolvedValueOnce({
      id: 'order',
      total: 100,
      order_number: 'ORD-STAGING-1',
      payment_method: 'oxygen',
      payment_status: paymentStatus,
      shipping_status: 'pending',
      prefill: {},
    });
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'activated' },
      controller: {},
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
    const result = render(<OxygenCheckoutScreen orderId="order" />);
    if (paymentStatus === 'unpaid') {
      expect(await screen.findByText('Order Confirmed')).toBeTruthy();
      expect(screen.getByText('#ORD-STAGING-1')).toBeTruthy();
      expect(screen.getByText('Upfront payment confirmed')).toBeTruthy();
      expect(screen.queryByText('View Receipt')).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order',
        orderNumber: 'ORD-STAGING-1',
        paymentMethod: 'oxygen',
      },
    });
    result.rerender(<OxygenCheckoutScreen orderId="order" />);
    expect(router.replace).toHaveBeenCalledTimes(1);
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

it('keeps transient workflow state mounted during the confirmed OTP presentation', async () => {
  jest.useFakeTimers();
  mockWorkflowUnmounts = 0;
  const caps = jest.fn().mockResolvedValue({ mobileEnabled: false });
  jest.mocked(oxygenNativeSession).mockReturnValue({
    capabilities: caps,
    profile: { merchantId: 'merchant' },
    workflow: jest.fn(),
    client: {},
  } as unknown as ReturnType<typeof oxygenNativeSession>);
  jest.mocked(readOwnedOxygenOrder).mockResolvedValue({
    id: 'order',
    total: 100,
    payment_method: 'oxygen',
    payment_status: 'pending',
    shipping_status: 'pending',
    prefill: {},
  });
  const state = {
    snapshot: {
      workflowId: 'workflow',
      stage: 'kyc_required',
      state: { applicationReference: 'reference', validated: false },
    },
    controller: {},
    busy: false,
    error: null,
    refresh: jest.fn(),
  };
  let update: (next: ReturnType<typeof useOxygenWorkflow>) => void = () =>
    undefined;
  jest.mocked(useOxygenWorkflow).mockImplementation(() => {
    const [current, setCurrent] = useState(
      state as unknown as ReturnType<typeof useOxygenWorkflow>
    );
    update = setCurrent;
    return current;
  });
  const view = render(<OxygenCheckoutScreen orderId="order" />);
  await act(async () => {});
  act(() =>
    update({
      ...state,
      snapshot: {
        ...state.snapshot,
        state: { ...state.snapshot.state, validated: true },
      },
    } as unknown as ReturnType<typeof useOxygenWorkflow>)
  );
  view.rerender(<OxygenCheckoutScreen orderId="order" />);
  expect(screen.getByText('OTP success')).toBeTruthy();
  expect(mockWorkflowUnmounts).toBe(0);
  act(() => jest.advanceTimersByTime(850));
  expect(screen.getByText('Saved workflow')).toBeTruthy();
  expect(mockWorkflowUnmounts).toBe(0);
  view.unmount();
  jest.useRealTimers();
});
