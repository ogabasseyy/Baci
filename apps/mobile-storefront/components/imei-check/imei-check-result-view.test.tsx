import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import Colors from '@/constants/Colors';
import type { ImeiResult } from '@/lib/validation';
import { getVerdictColors } from './get-verdict-colors';
import { ImeiCheckResultView } from './imei-check-result-view';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: {
    // Render headerLeft so tests can exercise the header back button.
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) => (
      <>{options?.headerLeft?.() ?? null}</>
    ),
  },
}));
jest.mock('./imei-remediation-offer', () => ({
  ImeiRemediationOffer: ({ lookupId }: { lookupId: string }) => {
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return <Text>{`Unlock offer for ${lookupId}`}</Text>;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const cleanResult: ImeiResult = {
  imei: '490154203237518',
  device: 'iPhone 13 Pro',
  modelNumber: 'A2638',
  status: 'Clean',
  icloud: 'Off',
  icloudLock: 'Unlocked',
  simLock: 'Unlocked',
  blacklistStatus: 'Not Blacklisted',
  carrier: 'Unlocked',
  deviceImage: 'https://cdn.example.com/iphone13pro.jpg',
  score: 94,
  activationStatus: 'Activated',
  serialNumber: 'F2LDN12345',
  purchaseDate: '2025-09-22',
  purchaseCountry: 'Nigeria',
  warranty: 'Limited Warranty',
  refurbished: 'No',
  demoUnit: 'No',
  mdmStatus: 'OFF',
  miLockStatus: 'Unlocked',
  miLostStatus: 'Clean',
  deviceType: 'apple',
  verdict: 'Safe to buy',
  verdictType: 'safe',
};

const baseProps = {
  colors: Colors.light,
  currentTier: IMEI_SERVICE_TIERS.full,
  result: cleanResult,
  onReset: jest.fn(),
};

describe('ImeiCheckResultView', () => {
  it.each([
    'Blacklisted',
    'Unknown',
  ])('does not mount unlock assessment for %s blacklist evidence', (blacklistStatus) => {
    render(
      <ImeiCheckResultView
        {...baseProps}
        lookupId="lookup-1"
        apiBaseUrl="https://ogabassey.com"
        result={{ ...cleanResult, blacklistStatus, simLock: 'Locked' }}
      />
    );
    expect(screen.queryByText('Unlock offer for lookup-1')).toBeNull();
  });

  it('shows colour and storage from the identified profile', () => {
    render(
      <ImeiCheckResultView
        {...baseProps}
        result={{
          ...cleanResult,
          deviceProfile: {
            version: 1,
            brand: 'Apple',
            model: 'iPhone 17 Pro Max',
            color: 'Silver',
            storage: '512GB',
            imageMatch: 'color',
          },
        }}
      />
    );
    expect(screen.getByText('Silver · 512GB')).toBeTruthy();
    expect(screen.getByText('Catalog illustration · Silver')).toBeTruthy();
  });

  it('shows caution when the report did not check the blacklist', () => {
    render(
      <ImeiCheckResultView
        {...baseProps}
        result={{
          ...cleanResult,
          status: 'Unknown',
          blacklistStatus: 'Unknown',
          score: 70,
        }}
      />
    );
    expect(screen.getByText('70%')).toHaveStyle({
      color: getVerdictColors('caution', Colors.light).text,
    });
  });

  it('renders the device summary, IMEI, and trust score for a clean result', () => {
    render(<ImeiCheckResultView {...baseProps} />);

    expect(screen.getByText('iPhone 13 Pro')).toBeTruthy();
    expect(screen.getByText('IMEI: 490154203237518')).toBeTruthy();
    expect(screen.getByText('Model: A2638')).toBeTruthy();
    expect(screen.getByText('94%')).toBeTruthy();
    expect(screen.getByText('Full Report')).toBeTruthy();
  });

  it('shows status cards and the verdict copy', () => {
    render(<ImeiCheckResultView {...baseProps} />);

    expect(screen.getByText('Blacklist Status')).toBeTruthy();
    expect(screen.getByText('Not Blacklisted')).toBeTruthy();
    expect(screen.getByText('Find My iPhone')).toBeTruthy();
    expect(screen.getByText('Safe to buy')).toBeTruthy();
  });

  it('renders extended provider fields returned by paid reports', () => {
    render(<ImeiCheckResultView {...baseProps} />);

    expect(screen.getByText('Activation Status')).toBeTruthy();
    expect(screen.getByText('Serial Number')).toBeTruthy();
    expect(screen.getByText('F2LDN12345')).toBeTruthy();
    expect(screen.getByText('Purchase Date')).toBeTruthy();
    expect(screen.getByText('2025-09-22')).toBeTruthy();
    expect(screen.getByText('Purchase Country')).toBeTruthy();
    expect(screen.getByText('Nigeria')).toBeTruthy();
    expect(screen.getByText('Warranty')).toBeTruthy();
    expect(screen.getByText('Limited Warranty')).toBeTruthy();
    expect(screen.getByText('Refurbished')).toBeTruthy();
    expect(screen.getByText('Demo Unit')).toBeTruthy();
    expect(screen.getByText('MDM Status')).toBeTruthy();
  });

  it('renders Xiaomi lock and lost status fields when present', () => {
    render(
      <ImeiCheckResultView
        {...baseProps}
        result={{
          ...cleanResult,
          device: 'Xiaomi 14',
          deviceType: 'android',
          miLockStatus: 'Locked',
          miLostStatus: 'Clean',
        }}
      />
    );

    expect(screen.getByText('Mi Lock Status')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByText('Mi Lost Status')).toBeTruthy();
    expect(screen.getByText('Clean')).toBeTruthy();
  });

  it('invokes onReset when the user taps "Check Another Device"', () => {
    const onReset = jest.fn();
    render(<ImeiCheckResultView {...baseProps} onReset={onReset} />);

    fireEvent.press(screen.getByText('Check Another Device'));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('mounts server-approved remediation only with lookup context', () => {
    render(
      <ImeiCheckResultView
        {...baseProps}
        result={{ ...cleanResult, simLock: 'Locked' }}
        apiBaseUrl="https://shop.example.com"
        lookupId="11111111-1111-4111-8111-111111111111"
      />
    );

    expect(screen.getByText(/unlock offer for 11111111/i)).toBeTruthy();
  });

  it('returns to the checker via onReset from the header back button (never pops to home)', () => {
    const onReset = jest.fn();
    render(<ImeiCheckResultView {...baseProps} onReset={onReset} />);

    fireEvent.press(screen.getByLabelText('Back'));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.back)).not.toHaveBeenCalled();
  });

  it('omits the model line when the result has no model number', () => {
    const { modelNumber: _modelNumber, ...rest } = cleanResult;
    render(<ImeiCheckResultView {...baseProps} result={rest as ImeiResult} />);

    expect(screen.queryByText(/^Model:/)).toBeNull();
  });
});
