import { render, screen } from '@testing-library/react-native';
import { Text as MockText } from 'react-native';
import OxygenVisualQaRoute from '../../app/oxygen-visual-qa';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <MockText>Redirect {href}</MockText>
  ),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ step: 'identity' }),
}));

jest.mock('./OxygenPreview', () => ({
  OxygenPreview: () => <MockText>Synthetic Oxygen preview</MockText>,
}));

const originalDev = __DEV__;
const stage = process.env.EXPO_PUBLIC_OXYGEN_STAGING;
const origin = process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN;

beforeEach(() => {
  Reflect.set(globalThis, '__DEV__', true);
  process.env.EXPO_PUBLIC_OXYGEN_STAGING = '1';
  process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN = 'http://127.0.0.1:3198';
});

afterEach(() => {
  Reflect.set(globalThis, '__DEV__', originalDev);
  if (stage === undefined) delete process.env.EXPO_PUBLIC_OXYGEN_STAGING;
  else process.env.EXPO_PUBLIC_OXYGEN_STAGING = stage;
  if (origin === undefined) delete process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN;
  else process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN = origin;
});

it('redirects in release builds even with the mock origin configured', () => {
  Reflect.set(globalThis, '__DEV__', false);
  render(<OxygenVisualQaRoute />);
  expect(screen.getByText('Redirect /')).toBeOnTheScreen();
  expect(screen.queryByText('Synthetic Oxygen preview')).toBeNull();
});

it('explains the required environment when the fixture origin differs', () => {
  process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN = 'https://example.com';
  render(<OxygenVisualQaRoute />);
  expect(
    screen.getByText(/requires the local iOS fixture server/)
  ).toBeOnTheScreen();
  expect(screen.queryByText('Synthetic Oxygen preview')).toBeNull();
});

it('opens the synthetic fixture with the exact development profile', () => {
  render(<OxygenVisualQaRoute />);
  expect(screen.getByText('Synthetic Oxygen preview')).toBeOnTheScreen();
});
