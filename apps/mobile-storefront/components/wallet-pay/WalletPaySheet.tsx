import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { WalletPinContextStrip } from '../wallet/savings/WalletPinContextStrip';
import { WalletPinDots } from '../wallet/savings/WalletPinDots';
import { WalletPinPad } from '../wallet/savings/WalletPinPad';
import { walletPinSheetStyles as styles } from '../wallet/savings/WalletPinSheet.styles';
import { WalletPinSheetHeader } from '../wallet/savings/WalletPinSheetHeader';
import type { WalletPaySheetState } from './use-wallet-pay-sheet';
import { WalletPayNoticeCard } from './WalletPayNoticeCard';
import { walletPayNotice } from './wallet-pay-notice';

type WalletColors = (typeof Colors)['light'];

function Button({
  colors,
  label,
  onPress,
  primary = true,
  busy = false,
  ready = true,
}: {
  colors: WalletColors;
  label: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
  ready?: boolean;
}) {
  if (!primary)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.secondary}
      >
        <Text style={[styles.secondaryText, { color: colors.primary }]}>
          {label}
        </Text>
      </Pressable>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.primary,
        { backgroundColor: ready ? colors.primary : colors.muted },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryForeground} size="small" />
      ) : (
        <Text
          style={[
            styles.primaryText,
            { color: ready ? colors.primaryForeground : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Pay for one purchase from the PiggyVest wallet: the same in-sheet PIN pad
 * and dots as savings, sized to its content, then a calm outcome card instead
 * of an alert. The purchase result itself is shown by the screen.
 */
export function WalletPaySheet<Result>({
  colors,
  purchase,
  sheet,
  onOpenWallet,
  onSignIn,
}: {
  colors: WalletColors;
  /** What is being paid for, e.g. "IMEI check". */
  purchase: string;
  sheet: WalletPaySheetState<Result>;
  onOpenWallet: () => void;
  onSignIn: () => void;
}) {
  const amount =
    sheet.amountKobo === null
      ? null
      : formatNgnCurrency(sheet.amountKobo / 100);
  const context = amount
    ? `Paying ${amount} for your ${purchase}`
    : `Paying for your ${purchase}`;
  const entering = sheet.step === 'enter';
  const notice =
    sheet.step === 'outcome' && sheet.outcome
      ? walletPayNotice(sheet.outcome, sheet.amountKobo, purchase)
      : null;
  // Closing while a payment is being sent would only hide it: wait for it.
  const closable = sheet.step !== 'paying';
  return (
    <ModalSheet
      visible={sheet.step !== 'closed'}
      animationType="slide"
      backdropStyle={styles.backdrop}
      onRequestClose={closable ? sheet.close : undefined}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <WalletPinSheetHeader
          colors={colors}
          title={
            notice
              ? notice.title
              : entering
                ? 'Enter your wallet PIN'
                : 'Pay from PiggyVest'
          }
          closeLabel={entering ? 'Cancel' : 'Close'}
          onClose={closable ? sheet.close : undefined}
        />
        {notice ? null : (
          <WalletPinContextStrip colors={colors} text={context} />
        )}
        {sheet.step === 'starting' || sheet.step === 'paying' ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              {sheet.step === 'starting'
                ? 'Getting your payment ready...'
                : 'Paying from your PiggyVest wallet...'}
            </Text>
          </View>
        ) : null}
        {entering ? (
          <>
            <WalletPinDots
              colors={colors}
              label="PIN"
              length={sheet.pin.length}
            />
            {sheet.error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: colors.error }]}
              >
                {sheet.error}
              </Text>
            ) : null}
            <WalletPinPad
              colors={colors}
              disabled={sheet.busy}
              onChange={sheet.setPin}
              value={sheet.pin}
            />
            <Button
              colors={colors}
              label={amount ? `Pay ${amount}` : 'Pay'}
              busy={sheet.busy}
              ready={sheet.pin.length >= 4}
              onPress={() => void sheet.submit()}
            />
            <View style={styles.footer}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text
                style={[styles.footerText, { color: colors.textSecondary }]}
              >
                Never share your PIN with anyone.
              </Text>
            </View>
          </>
        ) : null}
        {notice ? (
          <>
            <WalletPayNoticeCard colors={colors} notice={notice} />
            {notice.action === 'check_again' ? (
              <Button
                colors={colors}
                label="Check again"
                onPress={() => void sheet.recheck()}
              />
            ) : null}
            {notice.action === 'open_wallet' ? (
              <Button
                colors={colors}
                label="Open wallet"
                onPress={onOpenWallet}
              />
            ) : null}
            {notice.action === 'sign_in' ? (
              <Button colors={colors} label="Sign in" onPress={onSignIn} />
            ) : null}
            <Button
              colors={colors}
              label="Done"
              primary={notice.action === null}
              onPress={sheet.close}
            />
          </>
        ) : null}
      </View>
    </ModalSheet>
  );
}
