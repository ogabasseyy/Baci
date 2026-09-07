import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockNative = { callback: () => {} };
const mockPickupBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (_prevent: boolean, callback: () => void) => {
    mockNative.callback = callback;
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/use-repair-devices', () => ({
  useRepairDevices: () => ({ groups: [], brandGroups: [], query: '' }),
}));
jest.mock('@/hooks/use-repair-device-detail', () => ({
  useRepairDeviceDetail: () => ({}),
}));
jest.mock('@/hooks/use-repair-booking', () => ({
  useRepairBooking: () => ({ result: null }),
}));
jest.mock('./RepairDeviceCatalog', () => ({
  RepairDeviceCatalog: ({
    onDescribeInstead,
  }: {
    onDescribeInstead: () => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={onDescribeInstead}>
        <Text>Start repair</Text>
      </Pressable>
    );
  },
}));
jest.mock('./RepairBookingForm', () => ({
  RepairBookingForm: ({
    navigationBackRef,
  }: {
    navigationBackRef: { current: (() => void) | null };
  }) => {
    const { useEffect } = require('react');
    const { Text } = require('react-native');
    useEffect(() => {
      navigationBackRef.current = mockPickupBack;
      return () => {
        navigationBackRef.current = null;
      };
    }, [navigationBackRef]);
    return <Text>Pickup review</Text>;
  },
}));

import { RepairsCatalogScreen } from './RepairsCatalogScreen';

it('routes hardware and gesture back through the pickup handler without unmounting the form', () => {
  render(<RepairsCatalogScreen />);
  fireEvent.press(screen.getByText('Start repair'));
  act(() => mockNative.callback());
  expect(mockPickupBack).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Pickup review')).toBeTruthy();
});
