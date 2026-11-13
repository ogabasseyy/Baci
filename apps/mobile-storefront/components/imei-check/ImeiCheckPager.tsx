import {
  IMEI_DEVICE_CATEGORIES,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import type { RefObject } from 'react';
import { View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { ImeiCheckDevicePage } from './ImeiCheckDevicePage';
import type { ImeiCheckerColors } from './imei-check.types';
import type { ImeiWalletPayView } from './imei-check-form-view';

interface ImeiCheckPagerProps {
  colors: ImeiCheckerColors;
  error: string | null;
  initialPage: number;
  isLoading: boolean;
  isWalletError: boolean;
  isWalletLoading: boolean;
  pagerRef: RefObject<PagerView | null>;
  visitedDevices: Record<ImeiDeviceCategory, boolean>;
  walletBalance: number;
  walletIsStoreCredit?: boolean;
  /** True when the second wallet can pay this check (see use-imei-wallet-pay). */
  walletPay?: ImeiWalletPayView;
  onPageSelected: (event: { nativeEvent: { position: number } }) => void;
  onVerify: (tier: ImeiServiceTierKey, imei: string) => void;
  onTopUpWallet: (amount: number) => void;
}

export function ImeiCheckPager({
  colors,
  error,
  initialPage,
  isLoading,
  isWalletError,
  isWalletLoading,
  pagerRef,
  visitedDevices,
  walletBalance,
  walletIsStoreCredit,
  walletPay,
  onPageSelected,
  onVerify,
  onTopUpWallet,
}: ImeiCheckPagerProps) {
  return (
    <PagerView
      ref={pagerRef}
      testID="imei-device-pager"
      style={{ flex: 1 }}
      initialPage={initialPage}
      onPageSelected={onPageSelected}
    >
      {IMEI_DEVICE_CATEGORIES.map((category) => (
        <View key={category.id} collapsable={false} style={{ flex: 1 }}>
          {visitedDevices[category.id] ? (
            <ImeiCheckDevicePage
              device={category.id}
              colors={colors}
              error={error}
              isLoading={isLoading}
              isWalletError={isWalletError}
              isWalletLoading={isWalletLoading}
              walletBalance={walletBalance}
              walletIsStoreCredit={walletIsStoreCredit}
              walletPay={walletPay}
              onVerify={onVerify}
              onTopUpWallet={onTopUpWallet}
            />
          ) : null}
        </View>
      ))}
    </PagerView>
  );
}
