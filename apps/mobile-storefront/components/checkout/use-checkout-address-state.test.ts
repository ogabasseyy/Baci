import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useCheckoutAddressState } from './use-checkout-address-state';

const mockSetIsContactCollapsed = jest.fn();

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRouteStarted: jest.fn(),
}));
jest.mock('@/components/checkout/use-checkout-shipping', () => ({
  useCheckoutShipping: () => ({
    setCommittedAddress: jest.fn(),
    shipping: true,
  }),
}));
jest.mock('./use-checkout-saved-addresses', () => ({
  useCheckoutSavedAddresses: () => ({
    selectedSavedAddressId: null,
    setIsContactCollapsed: mockSetIsContactCollapsed,
    openNewAddressEditor: jest.fn(),
  }),
}));

const baseProps = {
  customer: null,
  isAuthenticated: false,
  items: [],
  subtotal: 0,
  user: null,
};

it('settles a guest email and reopens contact when it is edited', () => {
  mockSetIsContactCollapsed.mockClear();
  const { result } = renderHook(() => useCheckoutAddressState(baseProps));

  act(() => {
    result.current.form.setValue('email', 'guest@example.com');
    result.current.form.setValue('firstName', 'Ada');
    result.current.form.setValue('lastName', 'Lovelace');
    result.current.form.setValue('phone', '08012345678');
    result.current.settleContactEmail();
  });

  expect(result.current.hasContactIdentity).toBe(true);

  act(() => result.current.form.setValue('email', 'new@example.com'));
  expect(result.current.hasContactIdentity).toBe(false);
});

it('treats prefilled contact with display formatting as settled', () => {
  const user = {
    id: 'user-2',
    email: 'bassey@example.com',
    user_metadata: {
      first_name: 'Bassey',
      last_name: 'John',
      phone: '+2349169449282',
    },
  } as never;
  const { result } = renderHook(() =>
    useCheckoutAddressState({ ...baseProps, isAuthenticated: true, user })
  );

  act(() => {
    result.current.form.setValue('phone', '+234 9169449282');
  });

  expect(result.current.hasContactIdentity).toBe(true);
});

it('treats the same subscriber line with different prefixes as settled', () => {
  const user = {
    id: 'user-3',
    email: 'bassey@example.com',
    user_metadata: {
      first_name: 'Bassey',
      last_name: 'John',
      phone: '09169449282',
    },
  } as never;
  const { result } = renderHook(() =>
    useCheckoutAddressState({ ...baseProps, isAuthenticated: true, user })
  );

  act(() => {
    result.current.form.setValue('phone', '+234 9169449282');
  });

  expect(result.current.hasContactIdentity).toBe(true);
});

it('hydrates authenticated initial identity into the form', () => {
  const user = {
    id: 'user-1',
    email: 'ada@example.com',
    user_metadata: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '08012345678',
    },
  } as never;
  const { result } = renderHook(() =>
    useCheckoutAddressState({ ...baseProps, isAuthenticated: true, user })
  );

  expect(result.current.form.getValues('email')).toBe('ada@example.com');
});
