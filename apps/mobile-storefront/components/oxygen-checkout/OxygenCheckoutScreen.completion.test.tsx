import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { ZeroBalanceOxygenOrderError } from '@/services/oxygen/owned-order';
import {
  OxygenCheckoutScreen,
  oxygenNativeSession,
  readOwnedOxygenOrder,
  resetWorkflowUnmounts,
  router,
  savedCheckoutFixture,
  useOxygenWorkflow,
  workflowUnmountCount,
} from './OxygenCheckoutScreen.test-utils';

describe('saved native Oxygen checkout completion', () => {
  const { capabilities, refresh } = savedCheckoutFixture();
  it('continues an owned production order while new applications are disabled', async () => {
    const session = jest
      .mocked(oxygenNativeSession)
      .getMockImplementation()?.();
    if (!session) throw new Error('Expected test session');
    jest.mocked(oxygenNativeSession).mockReturnValue({
      ...session,
      profile: { ...session.profile, environment: 'production' },
    });
    capabilities.mockResolvedValue({ mobileEnabled: false });
    render(<OxygenCheckoutScreen orderId="order" />);
    expect(await screen.findByText('Saved workflow')).toBeTruthy();
    expect(readOwnedOxygenOrder).toHaveBeenCalledWith(
      'order',
      'customer',
      'merchant'
    );
  });

  it.each([
    'unpaid',
    'bnpl_approved',
  ])('uses the owned order state after activation (%s)', async (paymentStatus) => {
    jest.mocked(readOwnedOxygenOrder).mockResolvedValueOnce({
      id: 'order',
      total: 100,
      payableTotal: 100,
      order_number: 'ORD-STAGING-1',
      payment_method: 'oxygen',
      payment_status: paymentStatus,
      shipping_status: 'pending',
      prefill: {},
    });
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'activated' },
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
    const result = render(<OxygenCheckoutScreen orderId="order" />);
    if (paymentStatus === 'unpaid') {
      const title = await screen.findByText('Order Confirmed');
      const scroll = result.UNSAFE_getByType(ScrollView);
      let ancestor = title.parent;
      while (ancestor && ancestor !== scroll) ancestor = ancestor.parent;
      expect(ancestor).toBe(scroll);
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

  it('renders store-credit completion instead of retry error when an unpaid Oxygen order is 100% covered', async () => {
    jest
      .mocked(readOwnedOxygenOrder)
      .mockRejectedValueOnce(
        new ZeroBalanceOxygenOrderError('order', 'ORD-ZERO-1')
      );
    render(<OxygenCheckoutScreen orderId="order" />);

    expect(
      await screen.findByText(
        'This order is fully covered by store credit. No Oxygen financing or additional payment is required.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText('Saved workflow')).toBeNull();

    fireEvent.press(screen.getByText('View order confirmation'));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order',
        orderNumber: 'ORD-ZERO-1',
        paymentMethod: 'oxygen',
      },
    });
  });
});

it('keeps transient workflow state mounted during the confirmed OTP presentation', async () => {
  jest.useFakeTimers();
  resetWorkflowUnmounts();
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
    payableTotal: 100,
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
    controller: {
      getState: () => ({ error: null, capabilities: { mobileEnabled: false } }),
    },
    capabilities: { mobileEnabled: false },
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
  expect(workflowUnmountCount()).toBe(0);
  act(() => jest.advanceTimersByTime(850));
  expect(screen.getByText('Saved workflow')).toBeTruthy();
  expect(workflowUnmountCount()).toBe(0);
  view.unmount();
  jest.useRealTimers();
});
