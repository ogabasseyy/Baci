import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { OrderGiglShippingState } from '@/hooks/orders/useOrderGiglShipping';
import { useTheme } from '@/hooks/useTheme';
import { formatMerchantAmount } from '@/lib/format-merchant-currency';
import type {
  MerchantWalletFundingAccount,
  OrderGiglMissingField,
  OrderGiglQuote,
  OrderGiglReceiver,
} from '@/lib/order-gigl-shipping';
import { ShipmentOptionCard } from './ShipmentOptionCard';

const formatPrice = (amount: number) =>
  formatMerchantAmount(
    amount,
    { payout_currency: 'NGN' },
    { minimumFractionDigits: 0 }
  );

interface Props {
  addressDraft: Partial<OrderGiglReceiver>;
  error: string | null;
  fundingAccount: MerchantWalletFundingAccount | null;
  missingFields: OrderGiglMissingField[];
  onAddressFieldChange: (field: OrderGiglMissingField, value: string) => void;
  onFundWallet: () => void;
  onRefreshFundingAccount: () => void;
  onModeChange: () => void;
  onRetryQuote: () => void;
  onTransferred: () => void;
  quote: OrderGiglQuote | null;
  selected: boolean;
  state: OrderGiglShippingState;
  wallet: {
    availableBalance: number;
    canBook: boolean;
    shortfall: number;
  } | null;
}

const FIELD_LABELS: Record<OrderGiglMissingField, string> = {
  address: 'Shipping address',
  city: 'Shipping city',
  state: 'Shipping state',
  phone: 'Shipping phone',
};

function ActionButton({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[panelStyles.button, { backgroundColor: colors.primary }]}
    >
      <Text style={{ color: colors.textOnPrimary, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ShipmentFlowGiglPanel({
  addressDraft,
  error,
  fundingAccount,
  missingFields,
  onAddressFieldChange,
  onFundWallet,
  onRefreshFundingAccount,
  onModeChange,
  onRetryQuote,
  onTransferred,
  quote,
  selected,
  state,
  wallet,
}: Props) {
  const { colors } = useTheme();
  const loading = state === 'loading';
  const description = quote
    ? `${quote.displayName} · ${quote.estimatedDays} day${quote.estimatedDays === 1 ? '' : 's'}`
    : loading
      ? 'Getting a fresh delivery price…'
      : 'Get a fresh GIG delivery price for this order.';

  return (
    <View>
      <ShipmentOptionCard
        colors={colors}
        description={description}
        disabled={loading}
        icon="paper-plane-outline"
        onPress={onModeChange}
        selected={selected}
        title="Ship with GIG"
      />

      {quote ? (
        <View style={panelStyles.summary}>
          <Text style={[panelStyles.price, { color: colors.text }]}>
            {formatPrice(quote.price)}
          </Text>
          {wallet ? (
            <>
              <Text style={{ color: colors.textSecondary }}>
                Wallet balance: {formatPrice(wallet.availableBalance)}
              </Text>
              {!wallet.canBook ? (
                <Text style={{ color: colors.textSecondary }}>
                  Shortfall: {formatPrice(wallet.shortfall)}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {missingFields.map((field) => (
        <View key={field} style={panelStyles.field}>
          <Text style={{ color: colors.text }}>{FIELD_LABELS[field]}</Text>
          <TextInput
            accessibilityLabel={FIELD_LABELS[field]}
            onChangeText={(value) => onAddressFieldChange(field, value)}
            style={[
              panelStyles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={addressDraft[field] ?? ''}
          />
        </View>
      ))}
      {missingFields.length > 0 ? (
        <ActionButton label="Retry quote" onPress={onRetryQuote} />
      ) : null}

      {selected &&
      quote &&
      wallet &&
      !wallet.canBook &&
      !fundingAccount &&
      state !== 'funding_pending' ? (
        <ActionButton
          disabled={state === 'funding'}
          label="Fund wallet"
          onPress={onFundWallet}
        />
      ) : null}
      {state === 'funding_pending' && !fundingAccount ? (
        <View>
          <Text style={{ color: colors.textSecondary }}>
            Your bank transfer account is being prepared. Check again shortly.
          </Text>
          <ActionButton
            label="Check funding status"
            onPress={onRefreshFundingAccount}
          />
        </View>
      ) : null}

      {selected && fundingAccount?.status === 'active' ? (
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
            <ActionButton
              label="Copy account number"
              onPress={() =>
                void Clipboard.setStringAsync(fundingAccount.accountNumber)
              }
            />
            <ActionButton
              label="Copy account name"
              onPress={() =>
                void Clipboard.setStringAsync(
                  fundingAccount.accountName ?? 'Merchant wallet'
                )
              }
            />
          </View>
          <ActionButton label="I've transferred" onPress={onTransferred} />
        </View>
      ) : null}

      {state === 'polling' ? (
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
  button: {
    alignItems: 'center',
    borderRadius: 20,
    marginBottom: 10,
    padding: 10,
  },
  copyRow: { flexDirection: 'row', gap: 8 },
  field: { gap: 6, marginBottom: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  price: { fontSize: 20, fontWeight: '700' },
  summary: { gap: 4, marginBottom: 12, paddingHorizontal: 12 },
});
