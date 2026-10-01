import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';

const mockDevicesState = {
  groups: [] as unknown[],
  isLoading: false,
  isUnavailable: false,
  error: null as string | null,
  query: '',
  setQuery: jest.fn(),
  refetch: jest.fn(),
};

jest.mock('@/hooks/use-repair-devices', () => ({
  useRepairDevices: () => mockDevicesState,
}));

jest.mock('@/hooks/use-repair-device-detail', () => ({
  useRepairDeviceDetail: () => ({
    detail: null,
    isLoading: false,
    isNotFound: false,
    error: null,
  }),
}));

jest.mock('@/hooks/use-repair-booking', () => ({
  useRepairBooking: () => ({
    isSubmitting: false,
    result: null,
    error: null,
    fieldErrors: null,
    submit: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import RepairsScreen from '@/app/repairs';

describe('RepairsScreen route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDevicesState.groups = [];
    mockDevicesState.isLoading = false;
    mockDevicesState.isUnavailable = false;
    mockDevicesState.error = null;
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  it('renders the device-first catalogue when repairs are enabled', () => {
    mockDevicesState.groups = [
      {
        brand: 'Apple',
        devices: [
          {
            id: 'd1',
            brand: 'Apple',
            model: 'iPhone 13',
            slug: 'apple-iphone-13',
            deviceType: 'Smartphone',
            imageUrl: null,
            productId: null,
          },
        ],
      },
    ];

    render(<RepairsScreen />);

    expect(screen.getByText('Find your device')).toBeOnTheScreen();
    expect(screen.getByText('iPhone 13')).toBeOnTheScreen();
  });

  it('falls back to the WhatsApp-only screen when the catalogue is unavailable', () => {
    mockDevicesState.isUnavailable = true;

    render(<RepairsScreen />);

    expect(screen.getByText('Our Services')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Book a Repair' }));

    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=`)
    );
  });
});
