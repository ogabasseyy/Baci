import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import { formatPiggyvestPurchaseMoney as money } from '@baci/shared/lib';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { z } from 'zod';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';

type Command = z.infer<typeof piggyvestPurchaseSchemas.confirmation>;
type Props = {
  quote: z.infer<typeof piggyvestPurchaseSchemas.published>;
  command: Command;
  device: string;
  contextKey: string;
  disabled: boolean;
  onPrepare: (command: Command) => Promise<unknown>;
};

export function PiggyvestPurchaseReview(props: Props) {
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];
  const quote = piggyvestPurchaseSchemas.published.safeParse(props.quote);
  const command = piggyvestPurchaseSchemas.confirmation.safeParse(
    props.command
  );
  const attempts = useRef(new Set<string>());
  const operationKey = command.success
    ? JSON.stringify([command.data.goalId, command.data.operationId])
    : '';
  const key = JSON.stringify([
    props.contextKey,
    props.quote,
    props.command,
    props.device,
    props.disabled,
  ]);
  const lifetime = useRef({ key, prepare: props.onPrepare, attempted: false });
  if (
    lifetime.current.key !== key ||
    lifetime.current.prepare !== props.onPrepare
  ) {
    lifetime.current = { key, prepare: props.onPrepare, attempted: false };
  }
  const token = lifetime.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState({
    token,
    checked: false,
    attempted: false,
  });
  const checked = state.token === token && state.checked;
  const attempted =
    attempts.current.has(operationKey) ||
    (state.token === token && state.attempted);
  if (
    !quote.success ||
    !command.success ||
    quote.data.goalId !== command.data.goalId ||
    JSON.stringify(quote.data.quote) !== JSON.stringify(command.data.quote)
  ) {
    return (
      <Text style={{ color: colors.text }}>
        Purchase review is unavailable.
      </Text>
    );
  }
  const published = quote.data;
  const amounts = published.quote;
  const disabled = props.disabled || attempted || !checked;
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: colors.text }]}
      >
        Review exact purchase
      </Text>
      <Text style={{ color: colors.text }}>{props.device}</Text>
      <Text style={{ color: colors.text }}>
        Pickup: {published.pickupName} — {published.pickupAddress.address},{' '}
        {published.pickupAddress.city}
      </Text>
      <Text style={{ color: colors.text }}>
        Device: {money(amounts.deviceKobo)}; delivery:{' '}
        {money(amounts.deliveryKobo)}; tax: {money(amounts.taxKobo)}; fees:{' '}
        {money(amounts.feeKobo)}; total: {money(amounts.totalKobo)}
      </Text>
      <Text style={{ color: colors.text }}>
        Your savings: {money(amounts.savingsKobo)}; principal included:{' '}
        {money(amounts.principalKobo)}; confirmed paid interest included:{' '}
        {money(amounts.paidInterestKobo)}; remaining payment (unresolved):{' '}
        {money(amounts.otherPaymentKobo)}; quoted surplus (not funds-use
        authority): {money(amounts.surplusKobo)}
      </Text>
      <Text style={{ color: colors.text }}>
        Pending interest is not spendable. Quote expires: {amounts.expiresAt}
      </Text>
      <Text style={{ color: colors.text }}>
        Terms: {amounts.termsVersion} — {amounts.termsHash}
      </Text>
      <Text style={{ color: colors.text }}>
        Preparation reserves locally only. Not purchased or fulfilled. Provider
        dispatch and fulfilment are unavailable.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Confirm exact purchase quote"
        accessibilityState={{ checked, disabled: props.disabled || attempted }}
        disabled={props.disabled || attempted}
        style={styles.control}
        onPress={() => setState({ token, checked: !checked, attempted: false })}
      >
        <Text style={{ color: colors.text }}>
          I confirm this exact device, pickup, amounts and terms.
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Prepare purchase"
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={styles.control}
        onPress={async () => {
          if (
            disabled ||
            lifetime.current !== token ||
            token.attempted ||
            attempts.current.has(operationKey)
          )
            return;
          attempts.current.add(operationKey);
          token.attempted = true;
          setState({ token, checked, attempted: true });
          await props.onPrepare(props.command).catch(() => undefined);
          if (!mounted.current || lifetime.current !== token) return;
          setState({ token, checked, attempted: true });
        }}
      >
        <Text style={{ color: colors.primary }}>Prepare purchase</Text>
      </Pressable>
      {attempted && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          Refresh authoritative status. Do not resubmit or start a new
          operation.
        </Text>
      )}
    </View>
  );
}
