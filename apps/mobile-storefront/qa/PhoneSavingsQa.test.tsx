import { fireEvent, render, screen } from '@testing-library/react-native';
import { hideAsync } from 'expo-splash-screen';
import { PhoneSavingsQa } from './PhoneSavingsQa';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default
);
jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../tools/test/runtime-journey-browser/client', () => ({
  createRuntimeJourneyBrowserClient: jest.fn(),
}));
jest.mock('../components/wallet/savings/PiggyvestSavingsScreen', () => ({
  PiggyvestSavingsScreen: () => null,
}));

it('shows synthetic isolation and fails closed without test configuration', async () => {
  delete process.env.EXPO_PUBLIC_PHONE_QA_ORIGIN;
  delete process.env.EXPO_PUBLIC_PHONE_QA_TOKEN;
  render(<PhoneSavingsQa />);
  expect(
    screen.getByText('ISOLATED PHONE TEST — synthetic data only')
  ).toBeTruthy();
  expect(hideAsync).not.toHaveBeenCalled();
  fireEvent(
    screen.getByText('ISOLATED PHONE TEST — synthetic data only'),
    'layout',
    { nativeEvent: { layout: { width: 400, height: 800 } } }
  );
  expect(hideAsync).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText(
      'Local backend unavailable. No production fallback. Ask Codex to check the test server.'
    )
  ).toBeTruthy();
});
