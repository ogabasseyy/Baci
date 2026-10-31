import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckResultView } from './imei-check-result-view';
import { cleanResult } from './imei-result.test-fixture';

let mockAvailable = true;
jest.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    loading: false,
    failed: false,
    availableTierKeys: mockAvailable ? ['blacklist'] : [],
  }),
}));
jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./imei-remediation-offer', () => ({
  ImeiRemediationOffer: () => null,
}));
const baseProps = {
  colors: Colors.light,
  currentTier: IMEI_SERVICE_TIERS.simLock,
  result: cleanResult,
  onReset: jest.fn(),
};
beforeEach(() => {
  mockAvailable = true;
});
it('offers a priced blacklist follow-up only for unchecked phone reports', () => {
  const onCheckBlacklist = jest.fn();
  render(
    <ImeiCheckResultView
      {...baseProps}
      currentTier={IMEI_SERVICE_TIERS.simLock}
      result={{ ...cleanResult, blacklistStatus: 'Unknown' }}
      onCheckBlacklist={onCheckBlacklist}
    />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Check blacklist status · ₦700' })
  );
  expect(onCheckBlacklist).toHaveBeenCalledTimes(1);
});

it.each([
  'Clean',
  'Blacklisted',
])('does not offer a second blacklist check when evidence is %s', (blacklistStatus) => {
  render(
    <ImeiCheckResultView
      {...baseProps}
      currentTier={IMEI_SERVICE_TIERS.simLock}
      result={{ ...cleanResult, blacklistStatus }}
      onCheckBlacklist={jest.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Check blacklist status · ₦700' })
  ).toBeNull();
});

it('hides the offer when the server disables blacklist checks', () => {
  mockAvailable = false;
  render(
    <ImeiCheckResultView
      {...baseProps}
      result={{ ...cleanResult, blacklistStatus: 'Unknown' }}
      onCheckBlacklist={jest.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Check blacklist status · ₦700' })
  ).toBeNull();
});
it('disables the follow-up while checking and preserves the report', () => {
  render(
    <ImeiCheckResultView
      {...baseProps}
      result={{ ...cleanResult, blacklistStatus: 'Unknown' }}
      onCheckBlacklist={jest.fn()}
      isChecking
    />
  );
  expect(
    screen.getByRole('button', { name: 'Check blacklist status · ₦700' })
  ).toBeDisabled();
  expect(screen.getByText('iPhone 13 Pro')).toBeTruthy();
});
