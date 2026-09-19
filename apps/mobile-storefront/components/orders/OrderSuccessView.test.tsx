import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { OrderSuccessView } from './OrderSuccessView';

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('@/components/icons/GoogleLogo', () => ({
  GoogleLogo: () => null,
}));

jest.mock('@/components/icons/SuccessIcon', () => ({
  SuccessIcon: () => null,
}));

jest.mock('@/components/ads/AdSlot', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
});

jest.mock('@/components/ui/PermissionModal', () => {
  const { Pressable, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    PermissionModal: ({
      onDeny,
      onGrant,
      visible,
    }: {
      onDeny: () => void;
      onGrant: () => void;
      visible: boolean;
    }) =>
      visible ? (
        <View>
          <Pressable accessibilityRole="button" onPress={onGrant}>
            <Text>Allow notifications</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDeny}>
            <Text>Not now</Text>
          </Pressable>
        </View>
      ) : null,
  };
});

function createProps() {
  return {
    colors: Colors.light,
    isDark: false,
    onContinueShopping: jest.fn(),
    onLeaveGoogleReview: jest.fn(),
    onPermissionDeny: jest.fn(),
    onPermissionGrant: jest.fn(),
    onViewOrders: jest.fn(),
    showPermissionModal: false,
  };
}

describe('OrderSuccessView', () => {
  it('renders invoice messaging and a fallback delivery timeline', () => {
    const onViewDocument = jest.fn();

    render(
      <OrderSuccessView
        {...createProps()}
        onViewDocument={onViewDocument}
        paymentMethod="invoice"
      />
    );

    expect(screen.getByText('Invoice ready')).toBeTruthy();
    expect(screen.getByText('Invoice Created')).toBeTruthy();
    expect(screen.queryByText('Order Placed!')).toBeNull();
    expect(screen.getByText('Delivery Timeline')).toBeTruthy();
    expect(screen.getByText('Shared after order confirmation')).toBeTruthy();
    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('View / Download Invoice')).toBeTruthy();
    expect(screen.queryByText('Payment Ref')).toBeNull();

    fireEvent.press(
      screen.getByRole('button', { name: 'View / Download Invoice' })
    );
    expect(onViewDocument).toHaveBeenCalledTimes(1);
  });

  it('renders order details and delegates accessible post-purchase actions', () => {
    const onContinueShopping = jest.fn();
    const onLeaveGoogleReview = jest.fn();
    const onViewOrders = jest.fn();

    render(
      <OrderSuccessView
        {...createProps()}
        deliveryEstimate="2 business days"
        onContinueShopping={onContinueShopping}
        onLeaveGoogleReview={onLeaveGoogleReview}
        onViewOrders={onViewOrders}
        orderNumber="BAC-100"
        paymentMethod="payforme"
        reference="pay-ref"
      />
    );

    expect(screen.getByText('Payment request ready')).toBeTruthy();
    expect(screen.getByText('Payment Request Created')).toBeTruthy();
    expect(screen.getByText('#BAC-100')).toBeTruthy();
    expect(screen.getByText('Estimated Delivery')).toBeTruthy();
    expect(screen.getByText('pay-ref')).toBeTruthy();

    fireEvent.press(
      screen.getByRole('button', { name: 'Leave a Google Review' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue Shopping' }));
    fireEvent.press(screen.getByRole('button', { name: 'View Orders' }));

    expect(onLeaveGoogleReview).toHaveBeenCalledTimes(1);
    expect(onContinueShopping).toHaveBeenCalledTimes(1);
    expect(onViewOrders).toHaveBeenCalledTimes(1);
  });

  it('renders a receipt action for confirmed orders when a document handler exists', () => {
    const onViewDocument = jest.fn();

    render(
      <OrderSuccessView
        {...createProps()}
        onViewDocument={onViewDocument}
        paymentMethod="paystack"
      />
    );

    expect(screen.getByText('Order Confirmed')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'View Receipt' }));

    expect(onViewDocument).toHaveBeenCalledTimes(1);
  });

  it('disables the document action while preparing a document', () => {
    // Arrange
    const onViewDocument = jest.fn();
    render(
      <OrderSuccessView
        {...createProps()}
        isDocumentLoading={true}
        onViewDocument={onViewDocument}
        paymentMethod="paystack"
      />
    );

    // Act
    const documentButton = screen.getByRole('button', { name: 'View Receipt' });
    fireEvent.press(documentButton);

    // Assert
    expect(screen.getByText('Preparing document...')).toBeTruthy();
    expect(documentButton.props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(onViewDocument).not.toHaveBeenCalled();
  });

  it('delegates notification permission decisions from the visible modal', () => {
    const onPermissionDeny = jest.fn();
    const onPermissionGrant = jest.fn();

    render(
      <OrderSuccessView
        {...createProps()}
        onPermissionDeny={onPermissionDeny}
        onPermissionGrant={onPermissionGrant}
        showPermissionModal={true}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Allow notifications' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));

    expect(onPermissionGrant).toHaveBeenCalledTimes(1);
    expect(onPermissionDeny).toHaveBeenCalledTimes(1);
  });

  it('unmounts the banner while the permission modal is open', () => {
    // Regression: an obscured ORDER_SUCCESS_BANNER must not load or report
    // impressions behind the permission modal.
    const { rerender } = render(
      <OrderSuccessView {...createProps()} showPermissionModal={false} />
    );
    expect(screen.getByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeTruthy();

    rerender(
      <OrderSuccessView {...createProps()} showPermissionModal={true} />
    );
    expect(screen.queryByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeNull();
  });

  it('unmounts the banner while the native permission prompt is in flight', () => {
    // Regression: granting the soft ask closes the modal before the native
    // system prompt resolves; remounting here loads the banner underneath
    // that prompt where the shopper cannot see or tap it.
    const { rerender } = render(
      <OrderSuccessView {...createProps()} isPermissionFlowActive={false} />
    );
    expect(screen.getByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeTruthy();

    rerender(
      <OrderSuccessView
        {...createProps()}
        isPermissionFlowActive={true}
        showPermissionModal={false}
      />
    );
    expect(screen.queryByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeNull();
  });

  it('unmounts the banner while the receipt preview is active', () => {
    // Regression: an obscured ORDER_SUCCESS_BANNER must not load or report
    // impressions behind the full-screen receipt preview.
    const { rerender } = render(
      <OrderSuccessView {...createProps()} isReceiptPreviewActive={false} />
    );
    expect(screen.getByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeTruthy();

    rerender(
      <OrderSuccessView {...createProps()} isReceiptPreviewActive={true} />
    );
    expect(screen.queryByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeNull();
  });

  it('unmounts the banner while a fullscreen ad owns the screen', () => {
    // Regression: the delayed post-order interstitial presents over this
    // screen, so the banner must not request or refresh while obscured
    // underneath it.
    const { rerender } = render(
      <OrderSuccessView {...createProps()} isFullscreenAdActive={false} />
    );
    expect(screen.getByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeTruthy();

    rerender(
      <OrderSuccessView {...createProps()} isFullscreenAdActive={true} />
    );
    expect(screen.queryByTestId('ad-slot-ORDER_SUCCESS_BANNER')).toBeNull();
  });
});
