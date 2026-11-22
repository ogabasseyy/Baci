import * as Clipboard from 'expo-clipboard';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderGiglShippingState } from '@/hooks/orders/useOrderGiglShipping';
import { useTheme } from '@/hooks/useTheme';
import { formatMerchantPrice } from '@/lib/format-merchant-currency';
import type {
  MerchantWalletFundingAccount,
  OrderGiglMissingField,
  OrderGiglQuote,
  OrderGiglReceiver,
  OrderGiglSelectedPlace,
} from '@/lib/order-gigl-shipping';
import { getGiglWalletDetails } from './getGiglWalletDetails';
import { ShipmentFlowActionButton } from './ShipmentFlowActionButton';
import { ShipmentFlowGiglAddress } from './ShipmentFlowGiglAddress';
import {
  ShipmentOptionCard,
  type ShipmentOptionDetail,
} from './ShipmentOptionCard';

const formatPrice = (amount: number) =>
  formatMerchantPrice(amount, { payout_currency: 'NGN' });

// One line: "GoStandard · 2 days · Abakaliki" (the state when no city).
function getQuoteSummary(
  quote: OrderGiglQuote,
  address: Partial<OrderGiglReceiver>
): string {
  const days = `${quote.estimatedDays} day${quote.estimatedDays === 1 ? '' : 's'}`;
  const place = address.city?.trim() || address.state?.trim();
  return [quote.serviceTier || quote.displayName, days, place]
    .filter(Boolean)
    .join(' · ');
}

// While a price loads the card keeps the height of a priced card the wallet
// can pay, so the common case does not jump when the price arrives. A short
// wallet adds the top-up line and the Fund wallet button on purpose.
const LOADING_PRICE = '₦ …';
const LOADING_DETAILS: ShipmentOptionDetail[] = [{ text: 'From your wallet' }];

interface Props {
  addressDraft: Partial<OrderGiglReceiver>;
  error: string | null;
  fundingAccount: MerchantWalletFundingAccount | null;
  missingFields: OrderGiglMissingField[];
  onAddressFieldChange: (field: OrderGiglMissingField, value: string) => void;
  onEditAddress?: () => void;
  onFundWallet: () => void;
  onPlaceSelect: (place: OrderGiglSelectedPlace) => void;
  onRefreshFundingAccount: () => void;
  onModeChange: () => void;
  onRetryQuote: () => void;
  onTransferred: () => void;
  /** Merchant-facing provider name, e.g. "GIG" — shown as "Ship with …". */
  providerName: string;
  quote: OrderGiglQuote | null;
  selected: boolean;
  state: OrderGiglShippingState;
  wallet: {
    availableBalance: number;
    canBook: boolean;
    paidByBaci?: boolean;
    shortfall: number;
  } | null;
}

export function ShipmentFlowGiglPanel({
  addressDraft,
  error,
  fundingAccount,
  missingFields,
  onAddressFieldChange,
  onEditAddress,
  onFundWallet,
  onPlaceSelect,
  onRefreshFundingAccount,
  onModeChange,
  onRetryQuote,
  onTransferred,
  providerName,
  quote,
  selected,
  state,
  wallet,
}: Props) {
  const { colors } = useTheme();
  const loading = state === 'loading';
  const description = quote
    ? getQuoteSummary(quote, addressDraft)
    : loading
      ? 'Getting a delivery price…'
      : `Get a ${providerName} delivery price for this order.`;
  const price = quote
    ? formatPrice(quote.price)
    : loading
      ? LOADING_PRICE
      : undefined;
  const details = quote
    ? getGiglWalletDetails(wallet)
    : loading
      ? LOADING_DETAILS
      : [];

  return (
    <View>
      <ShipmentOptionCard
        badge={providerName}
        colors={colors}
        description={description}
        details={details}
        disabled={loading}
        icon="paper-plane-outline"
        onPress={onModeChange}
        price={price}
        selected={selected}
        title={`Ship with ${providerName}`}
      />

      <ShipmentFlowGiglAddress
        addressDraft={addressDraft}
        loading={loading}
        missingFields={missingFields}
        onAddressFieldChange={onAddressFieldChange}
        onEditAddress={onEditAddress}
        onPlaceSelect={onPlaceSelect}
        onRetryQuote={onRetryQuote}
        selected={selected}
      />

      {selected &&
      quote &&
      wallet &&
      !wallet.paidByBaci &&
      !wallet.canBook &&
      !fundingAccount &&
      state !== 'funding_pending' ? (
        <ShipmentFlowActionButton
          disabled={state === 'funding'}
          label="Fund wallet"
          onPress={onFundWallet}
        />
      ) : null}
      {state === 'funding_pending' && !fundingAccount && !wallet?.paidByBaci ? (
        <View>
          <Text style={{ color: colors.textSecondary }}>
            Your bank transfer account is being prepared. Check again shortly.
          </Text>
          <ShipmentFlowActionButton
            label="Check funding status"
            onPress={onRefreshFundingAccount}
          />
        </View>
      ) : null}

      {selected &&
      !wallet?.paidByBaci &&
      fundingAccount?.status === 'active' ? (
        <View
          style={[
            panelStyles.account,
            {
              borderColor: colors.border,
              backgroundColor: colors.backgroundLight,
            },
          ]}
        >
          <Text style={{ color: colors.text }}>
            {fundingAccount.bankName ?? 'Bank'}
          </Text>
          <Text style={[panelStyles.accountNumber, { color: colors.text }]}>
            {fundingAccount.accountNumber}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            {fundingAccount.accountName ?? 'Merchant wallet'}
          </Text>
          <View style={panelStyles.copyRow}>
            <ShipmentFlowActionButton
              label="Copy account number"
              onPress={() =>
                void Clipboard.setStringAsync(fundingAccount.accountNumber)
              }
            />
            <ShipmentFlowActionButton
              label="Copy account name"
              onPress={() =>
                void Clipboard.setStringAsync(
                  fundingAccount.accountName ?? 'Merchant wallet'
                )
              }
            />
          </View>
          <ShipmentFlowActionButton
            label="I've transferred"
            onPress={onTransferred}
          />
        </View>
      ) : null}

      {state === 'polling' && !wallet?.paidByBaci ? (
        <Text style={{ color: colors.textSecondary }}>
          Checking your wallet balance…
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
    </View>
  );
}

const panelStyles = StyleSheet.create({
  account: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
    padding: 12,
  },
  accountNumber: { fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  copyRow: { flexDirection: 'row', gap: 8 },
});
