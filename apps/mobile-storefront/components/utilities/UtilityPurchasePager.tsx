import type { RefObject } from 'react';
import { View } from 'react-native';
import PagerView from 'react-native-pager-view';
import Animated from 'react-native-reanimated';
import { AirtimeForm } from '@/components/utilities/AirtimeForm';
import { BillForm } from '@/components/utilities/BillForm';
import { DataForm } from '@/components/utilities/DataForm';
import { getNetworkProviderId } from '@/components/utilities/utility-purchase.route-params';
import type {
  UtilityPurchaseResult,
  ValidUtilityType,
} from '@/components/utilities/utility-purchase.types';
import type {
  UtilityRepeatDefaults,
  UtilityRepeatRecipient,
} from '@/lib/utility-repeat';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

type QuickRepeatState = {
  handleRecipientSelect: (recipient: UtilityRepeatRecipient) => void;
  isRepeatPaymentReady: boolean;
  recentRecipients: UtilityRepeatRecipient[];
  repeatDefaults: UtilityRepeatDefaults;
  repeatRevision: number;
};

type UtilityPurchasePagerProps = {
  currentType: ValidUtilityType;
  initialPage: number;
  onPageScroll: (event: unknown) => void;
  onPageSelected: (event: { nativeEvent: { position: number } }) => void;
  onSuccess: (result: UtilityPurchaseResult) => void;
  pagerRef: RefObject<PagerView | null>;
  quickRepeat: QuickRepeatState;
  visitedTypes: Record<ValidUtilityType, boolean>;
};

export function UtilityPurchasePager({
  currentType,
  initialPage,
  onPageScroll,
  onPageSelected,
  onSuccess,
  pagerRef,
  quickRepeat,
  visitedTypes,
}: UtilityPurchasePagerProps) {
  return (
    <AnimatedPagerView
      ref={pagerRef}
      testID="pager-view"
      style={{ flex: 1 }}
      initialPage={initialPage}
      onPageScroll={onPageScroll}
      onPageSelected={onPageSelected}
    >
      <View key="airtime" collapsable={false} style={{ flex: 1 }}>
        {visitedTypes.airtime && (
          <AirtimeForm
            key={`airtime-${quickRepeat.repeatRevision}`}
            initialAmount={quickRepeat.repeatDefaults.amount}
            initialPhoneNumber={quickRepeat.repeatDefaults.phoneNumber}
            initialProvider={getNetworkProviderId(
              quickRepeat.repeatDefaults.networkProvider
            )}
            isRepeatPaymentReady={
              currentType === 'airtime'
                ? quickRepeat.isRepeatPaymentReady
                : false
            }
            recentRecipients={
              currentType === 'airtime' ? quickRepeat.recentRecipients : []
            }
            onSelectRecentRecipient={quickRepeat.handleRecipientSelect}
            onSuccess={(result) =>
              onSuccess({ ...result, utilityType: 'airtime' })
            }
          />
        )}
      </View>
      <View key="data" collapsable={false} style={{ flex: 1 }}>
        {visitedTypes.data && (
          <DataForm
            key={`data-${quickRepeat.repeatRevision}`}
            initialAmount={quickRepeat.repeatDefaults.amount}
            initialPhoneNumber={quickRepeat.repeatDefaults.phoneNumber}
            initialPlan={quickRepeat.repeatDefaults.dataPlanCode}
            initialProvider={quickRepeat.repeatDefaults.networkProvider}
            isRepeatPaymentReady={
              currentType === 'data' ? quickRepeat.isRepeatPaymentReady : false
            }
            recentRecipients={
              currentType === 'data' ? quickRepeat.recentRecipients : []
            }
            onSelectRecentRecipient={quickRepeat.handleRecipientSelect}
            onSuccess={(result) =>
              onSuccess({ ...result, utilityType: 'data' })
            }
          />
        )}
      </View>
      <View key="tv" collapsable={false} style={{ flex: 1 }}>
        {visitedTypes.tv && (
          <BillForm
            key={`tv-${quickRepeat.repeatRevision}`}
            initialAmount={quickRepeat.repeatDefaults.amount}
            initialBillerName={quickRepeat.repeatDefaults.billerName}
            initialBillItemIdentifier={
              quickRepeat.repeatDefaults.billItemIdentifier
            }
            initialCustomerIdentifier={
              quickRepeat.repeatDefaults.customerIdentifier
            }
            initialCustomerName={quickRepeat.repeatDefaults.customerName}
            initialCustomerAddress={quickRepeat.repeatDefaults.address}
            isRepeatPaymentReady={
              currentType === 'tv' ? quickRepeat.isRepeatPaymentReady : false
            }
            recentRecipients={
              currentType === 'tv' ? quickRepeat.recentRecipients : []
            }
            onSelectRecentRecipient={quickRepeat.handleRecipientSelect}
            type="tv"
            onSuccess={(result) => onSuccess({ ...result, utilityType: 'tv' })}
          />
        )}
      </View>
      <View key="power" collapsable={false} style={{ flex: 1 }}>
        {visitedTypes.power && (
          <BillForm
            key={`power-${quickRepeat.repeatRevision}`}
            initialAmount={quickRepeat.repeatDefaults.amount}
            initialBillerName={quickRepeat.repeatDefaults.billerName}
            initialBillItemIdentifier={
              quickRepeat.repeatDefaults.billItemIdentifier
            }
            initialCustomerIdentifier={
              quickRepeat.repeatDefaults.customerIdentifier
            }
            initialCustomerName={quickRepeat.repeatDefaults.customerName}
            initialCustomerAddress={quickRepeat.repeatDefaults.address}
            isRepeatPaymentReady={
              currentType === 'power' ? quickRepeat.isRepeatPaymentReady : false
            }
            recentRecipients={
              currentType === 'power' ? quickRepeat.recentRecipients : []
            }
            onSelectRecentRecipient={quickRepeat.handleRecipientSelect}
            type="power"
            onSuccess={(result) =>
              onSuccess({ ...result, utilityType: 'power' })
            }
          />
        )}
      </View>
      <View key="gaming" collapsable={false} style={{ flex: 1 }}>
        {visitedTypes.gaming && (
          <BillForm
            key={`gaming-${quickRepeat.repeatRevision}`}
            initialAmount={quickRepeat.repeatDefaults.amount}
            initialBillerName={quickRepeat.repeatDefaults.billerName}
            initialBillItemIdentifier={
              quickRepeat.repeatDefaults.billItemIdentifier
            }
            initialCustomerIdentifier={
              quickRepeat.repeatDefaults.customerIdentifier
            }
            initialCustomerName={quickRepeat.repeatDefaults.customerName}
            initialCustomerAddress={quickRepeat.repeatDefaults.address}
            isRepeatPaymentReady={
              currentType === 'gaming'
                ? quickRepeat.isRepeatPaymentReady
                : false
            }
            recentRecipients={
              currentType === 'gaming' ? quickRepeat.recentRecipients : []
            }
            onSelectRecentRecipient={quickRepeat.handleRecipientSelect}
            type="gaming"
            onSuccess={(result) =>
              onSuccess({ ...result, utilityType: 'gaming' })
            }
          />
        )}
      </View>
    </AnimatedPagerView>
  );
}
