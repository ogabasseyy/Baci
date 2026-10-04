import { piggyvestDeviceChangeSchemas as schemas } from '@baci/shared/contracts';
import { formatPiggyvestPurchaseMoney as money } from '@baci/shared/lib';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';

export function PiggyvestDeviceChangeReview(props: {
  published: ReturnType<typeof schemas.published.parse>;
  command: ReturnType<typeof schemas.confirmation.parse>;
  contextKey: string;
  disabled: boolean;
  onConfirm: (
    command: ReturnType<typeof schemas.confirmation.parse>
  ) => Promise<unknown>;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const published = schemas.published.safeParse(props.published);
  const command = schemas.confirmation.safeParse(props.command);
  const attempts = useRef(new Set<string>());
  const key = JSON.stringify([
    props.contextKey,
    props.published,
    props.command,
    props.disabled,
  ]);
  const lifetime = useRef({ key, callback: props.onConfirm });
  if (
    lifetime.current.key !== key ||
    lifetime.current.callback !== props.onConfirm
  )
    lifetime.current = { key, callback: props.onConfirm };
  const token = lifetime.current;
  const [state, setState] = useState({
    token,
    checked: false,
    attempted: false,
  });
  if (
    !published.success ||
    !command.success ||
    command.data.goalId !== published.data.quote.goalId ||
    JSON.stringify(command.data.quote) !== JSON.stringify(published.data.quote)
  )
    return (
      <Text style={{ color: colors.text }}>
        Device change review unavailable.
      </Text>
    );
  const quote = published.data.quote;
  const operation = JSON.stringify([
    command.data.goalId,
    command.data.operationId,
  ]);
  const attempted = attempts.current.has(operation);
  const checked = state.token === token && state.checked;
  const disabled = props.disabled || attempted;
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: colors.text }]}
      >
        Review device change
      </Text>
      <Text style={{ color: colors.text }}>
        {quote.device.productName} — {quote.device.variant ?? 'No variant'} —{' '}
        {quote.device.condition}
      </Text>
      <Text style={{ color: colors.text }}>
        Quoted device price: {money(quote.priceKobo)}
      </Text>
      <Text style={{ color: colors.text }}>
        Duration:{' '}
        {quote.durationMonths === null
          ? 'unavailable'
          : `${quote.durationMonths} months`}
      </Text>
      <Text style={{ color: colors.text }}>
        Maturity: {quote.maturesAt ?? 'unavailable'}; grace deadline:{' '}
        {quote.graceExpiresAt ?? 'unavailable'}; quote expiry: {quote.expiresAt}
      </Text>
      <Text style={{ color: colors.text }}>{published.data.terms.text}</Text>
      <Text style={{ color: colors.text }}>
        Terms version: {quote.termsVersion}
      </Text>
      <Text style={{ color: colors.text }}>
        The wallet and balances remain unchanged; collection pauses. This is not
        a purchase, withdrawal or provider instruction.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Accept exact device change"
        accessibilityState={{ checked, disabled }}
        disabled={disabled}
        style={styles.control}
        onPress={() => setState({ token, checked: !checked, attempted: false })}
      >
        <Text style={{ color: colors.text }}>
          I accept this exact device, price, duration, deadlines and terms.
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Confirm device change"
        accessibilityState={{ disabled: disabled || !checked }}
        disabled={disabled || !checked}
        style={styles.control}
        onPress={async () => {
          if (
            disabled ||
            !checked ||
            token !== lifetime.current ||
            attempts.current.has(operation)
          )
            return;
          attempts.current.add(operation);
          setState({ token, checked, attempted: true });
          try {
            await props.onConfirm(props.command);
          } catch {
            return;
          }
        }}
      >
        <Text style={{ color: colors.primary }}>Confirm device change</Text>
      </Pressable>
      {attempted && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          Read authoritative status. Do not resubmit or create a new operation.
          Callback completion does not authorize funding.
        </Text>
      )}
    </View>
  );
}
