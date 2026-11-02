import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';
import {
  order,
  props,
  recoveryLabel,
} from './ShipmentFlowSheet.recovery.test-support';

const state = vi.hoisted(() => ({
  busy: false,
  confirmed: false,
  preview: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
}));
vi.mock('./ShipmentFlowSheetPresence', () => ({
  ShipmentFlowSheetPresence: ({
    accessory,
    children,
    visible,
  }: {
    accessory?: ReactNode;
    children?: ReactNode;
    visible: boolean;
  }) =>
    visible ? (
      <section>
        {children}
        {accessory}
      </section>
    ) : null,
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant', user_id: 'owner' } }),
}));
vi.mock('@/hooks/orders/useCheckoutShippingRecovery', () => ({
  useCheckoutShippingRecovery: () => ({
    draft: {
      address: 'Saved street',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: '',
      phone: '08012345678',
      latitude: '',
      longitude: '',
    },
    busy: state.busy,
    confirmed: state.confirmed,
    preview: null,
    error: null,
    requestPreview: state.preview,
    confirm: state.confirm,
    update: state.update,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#555',
      primary: '#00f',
      border: '#ddd',
      card: '#fff',
      textOnPrimary: '#fff',
      backgroundLight: '#eee',
    },
  }),
}));
vi.mock('react-native', async () => ({
  ...(await vi.importActual<typeof import('react-native')>('react-native')),
  Alert: { alert: vi.fn() },
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <section>{children}</section> : null,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: () => false,
}));
vi.mock('@/components/ui/KeyboardAwareModalContainer', () => ({
  KeyboardAwareModalContainer: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('./ShipmentIdentifierScanner', () => ({
  ShipmentIdentifierScanner: () => null,
}));
vi.mock('./CheckoutRecoveryAddressInput', () => ({
  CheckoutRecoveryAddressInput: () => null,
}));

vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://synthetic.invalid' }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('ShipmentFlowSheet prepaid recovery staff access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.busy = false;
    state.confirmed = false;
  });
  it('preserves GIG booking rights and paid checkout eligibility when recovery is exposed outside provider mode', () => {
    const { rerender } = render(
      <ShipmentFlowSheet {...props} canBookGigl={false} />
    );
    expect(
      screen.queryByRole('button', { name: recoveryLabel })
    ).not.toBeInTheDocument();
    rerender(
      <ShipmentFlowSheet
        {...props}
        recoveryOrder={{ ...order, payment_status: 'pending' }}
      />
    );
    expect(
      screen.queryByRole('button', { name: recoveryLabel })
    ).not.toBeInTheDocument();
  });
});
