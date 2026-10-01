import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockDevicesState = {
  groups: [] as unknown[],
  brandGroups: [] as unknown[],
  isLoading: false,
  isUnavailable: false,
  error: null as string | null,
  query: '',
  setQuery: jest.fn(),
  refetch: jest.fn(),
};

const mockDetailState = {
  detail: null as unknown,
  isLoading: false,
  isNotFound: false,
  error: null as string | null,
  refetch: jest.fn(),
  slug: '',
};

const mockBookingState = {
  isSubmitting: false,
  result: null as { id: string; ticketNumber: number } | null,
  error: null as string | null,
  fieldErrors: null as Record<string, string[]> | null,
  submit: jest.fn(),
  reset: jest.fn(),
};

const mockPreventRemoveState: {
  prevent: boolean;
  callback: (() => void) | null;
} = {
  prevent: false,
  callback: null,
};

jest.mock('@/hooks/use-repair-devices', () => ({
  useRepairDevices: () => mockDevicesState,
}));

jest.mock('@/hooks/use-repair-device-detail', () => ({
  useRepairDeviceDetail: (slug: string) => {
    mockDetailState.slug = slug;
    return mockDetailState;
  },
}));

jest.mock('@/hooks/use-repair-booking', () => ({
  useRepairBooking: () => mockBookingState,
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    mockPreventRemoveState.prevent = prevent;
    mockPreventRemoveState.callback = callback;
  },
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import { RepairsCatalogScreen } from './RepairsCatalogScreen';

const appleGroup = {
  brand: 'Apple',
  devices: [
    {
      id: 'd1',
      brand: 'Apple',
      model: 'iPhone 13',
      slug: 'apple-iphone-13',
      deviceType: 'Smartphone' as const,
      imageUrl: null,
      productId: null,
    },
  ],
};

const quote = {
  id: 'q1',
  serviceTypeId: 'st1',
  serviceTypeName: 'Screen Replacement',
  price: 25000,
  isFromPrice: true,
  partQuality: null,
  turnaround: null,
  warrantyDays: null,
  description: null,
};

function resetState() {
  jest.clearAllMocks();
  mockDevicesState.groups = [];
  mockDevicesState.brandGroups = [];
  mockDevicesState.isLoading = false;
  mockDevicesState.isUnavailable = false;
  mockDevicesState.error = null;
  mockDetailState.detail = null;
  mockDetailState.isLoading = false;
  mockDetailState.isNotFound = false;
  mockDetailState.error = null;
  mockBookingState.isSubmitting = false;
  mockBookingState.result = null;
  mockBookingState.error = null;
  mockBookingState.fieldErrors = null;
  mockPreventRemoveState.prevent = false;
  mockPreventRemoveState.callback = null;
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
}

describe('RepairsCatalogScreen', () => {
  beforeEach(resetState);

  it('renders the WhatsApp-only fallback when the catalogue is unavailable', () => {
    mockDevicesState.isUnavailable = true;

    render(<RepairsCatalogScreen />);

    // Fallback hero copy from RepairsFallback.
    expect(screen.getByText("Don't Replace It.\nRepair It.")).toBeTruthy();
  });

  it('shows a loading indicator while devices load', () => {
    mockDevicesState.isLoading = true;

    render(<RepairsCatalogScreen />);

    expect(screen.getByLabelText('Loading repairs')).toBeTruthy();
  });

  it('renders the catalogue and drills into a device detail on selection', () => {
    mockDevicesState.groups = [appleGroup];
    mockDetailState.detail = {
      device: appleGroup.devices[0],
      quotes: [quote],
      product: null,
    };

    render(<RepairsCatalogScreen />);

    expect(screen.getByText('iPhone 13')).toBeTruthy();

    fireEvent.press(screen.getByText('iPhone 13'));

    // Device detail now shows the quote's service type.
    expect(screen.getByText('Screen Replacement')).toBeTruthy();
    expect(screen.getByText('From ₦25,000')).toBeTruthy();
  });

  it('advances from a quote to the booking form and submits', () => {
    mockDevicesState.groups = [appleGroup];
    mockDetailState.detail = {
      device: appleGroup.devices[0],
      quotes: [quote],
      product: null,
    };

    render(<RepairsCatalogScreen />);
    fireEvent.press(screen.getByText('iPhone 13'));
    fireEvent.press(screen.getByLabelText('Book Screen Replacement'));

    // Booking form: fill required fields.
    fireEvent.changeText(screen.getByLabelText('Full name'), 'Ada Lovelace');
    fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
    fireEvent.changeText(
      screen.getByLabelText('Describe the issue'),
      'The screen is cracked and needs replacing.'
    );
    fireEvent.press(screen.getByLabelText('Submit repair request'));

    expect(mockBookingState.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'd1',
        quoteId: 'q1',
        customerEmail: 'ada@example.com',
      })
    );
  });

  it('shows the ticket success screen when the booking resolves', () => {
    mockDevicesState.groups = [appleGroup];
    mockDetailState.detail = {
      device: appleGroup.devices[0],
      quotes: [quote],
      product: null,
    };
    mockBookingState.result = { id: 'repair-1', ticketNumber: 7788 };

    render(<RepairsCatalogScreen />);

    expect(screen.getByText('#7788')).toBeTruthy();
  });

  it('opens WhatsApp from the catalogue not-listed CTA', () => {
    mockDevicesState.groups = [appleGroup];

    render(<RepairsCatalogScreen />);
    fireEvent.press(screen.getByLabelText('Chat on WhatsApp'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/')
    );
  });

  it('steps back to the catalogue via the back intercept instead of leaving', () => {
    mockDevicesState.groups = [appleGroup];
    mockDetailState.detail = {
      device: appleGroup.devices[0],
      quotes: [quote],
      product: null,
    };

    render(<RepairsCatalogScreen />);

    // On catalogue the native back leaves normally (not intercepted).
    expect(mockPreventRemoveState.prevent).toBe(false);

    fireEvent.press(screen.getByText('iPhone 13'));
    // On detail the back is intercepted.
    expect(mockPreventRemoveState.prevent).toBe(true);

    // Firing the intercept returns to the catalogue.
    act(() => mockPreventRemoveState.callback?.());
    expect(screen.getByText('Find your device')).toBeTruthy();
  });
});
