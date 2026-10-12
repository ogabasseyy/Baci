import { piggyvestCancellationReviewSchemas as schemas } from '@baci/shared/contracts';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { z } from 'zod';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';

type Props = {
  contextKey?: string;
  sessionKey: string | null;
  goalId: string | null;
  operationId: string | null;
  quote: unknown;
  onPrepare: (
    confirmation: z.infer<typeof schemas.confirmation>
  ) => Promise<unknown>;
};
type ReviewState = {
  key: string;
  callback: Props['onPrepare'];
  checked: boolean;
  action: 'idle' | 'pending' | 'prepared' | 'uncertain';
};
function money(value: number) {
  const kobo = BigInt(value);
  return `NGN ${kobo / 100n}.${String(kobo % 100n).padStart(2, '0')}`;
}

export function PiggyvestCancellationReview(props: Props) {
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => {
      current.active = false;
    };
  }, []);
  const parsedGoal = schemas.confirmation.shape.goalId.safeParse(props.goalId);
  const parsedOperation = schemas.confirmation.shape.operationId.safeParse(
    props.operationId
  );
  const goalIdentity = parsedGoal.success
    ? parsedGoal.data.toLowerCase()
    : null;
  const operationIdentity = parsedOperation.success
    ? parsedOperation.data.toLowerCase()
    : null;
  const parsed = schemas.quote.safeParse(props.quote);
  const quote =
    parsed.success &&
    parsed.data.status === 'quote_available' &&
    parsed.data.goalId.toLowerCase() === goalIdentity &&
    typeof props.sessionKey === 'string' &&
    props.sessionKey.trim().length > 0 &&
    props.sessionKey.length <= 1024 &&
    operationIdentity !== null
      ? parsed.data
      : null;
  const key = JSON.stringify([
    props.contextKey,
    props.sessionKey,
    goalIdentity,
    operationIdentity,
    quote
      ? {
          ...quote,
          goalId: quote.goalId.toLowerCase(),
          revisionId: quote.revisionId.toLowerCase(),
        }
      : null,
  ]);
  const [state, setState] = useState<ReviewState>({
    key,
    callback: props.onPrepare,
    checked: false,
    action: 'idle',
  });
  if (state.key !== key || state.callback !== props.onPrepare) {
    setState({
      key,
      callback: props.onPrepare,
      checked: false,
      action: 'idle',
    });
  }
  const attempted = useRef(new Set<string>());
  const operationKey = JSON.stringify([
    props.sessionKey,
    goalIdentity,
    operationIdentity,
  ]);
  const blocked =
    !quote ||
    typeof props.onPrepare !== 'function' ||
    state.action !== 'idle' ||
    attempted.current.has(operationKey);
  async function prepare() {
    const current = lifetime.current;
    if (
      !current.active ||
      blocked ||
      !state.checked ||
      !quote ||
      attempted.current.has(operationKey)
    )
      return;
    attempted.current.add(operationKey);
    const pending: ReviewState = { ...state, action: 'pending' };
    setState(pending);
    try {
      const input = schemas.confirmation.parse({
        goalId: quote.goalId,
        operationId: props.operationId,
        revisionId: quote.revisionId,
        termsVersion: quote.termsVersion,
        termsHash: quote.termsHash,
        consentVersion: quote.consentVersion,
        principalKobo: quote.principalKobo,
        paidInterestKobo: quote.paidInterestKobo,
        pendingInterestKobo: quote.pendingInterestKobo,
        accepted: true,
      });
      const receipt = schemas.receipt.parse(await props.onPrepare(input));
      const prepared =
        receipt.status === 'prepared' &&
        receipt.goalId.toLowerCase() === input.goalId.toLowerCase() &&
        receipt.operationId.toLowerCase() === input.operationId.toLowerCase();
      if (current.active)
        setState((latest) =>
          latest === pending
            ? { ...latest, action: prepared ? 'prepared' : 'uncertain' }
            : latest
        );
    } catch {
      if (current.active)
        setState((latest) =>
          latest === pending ? { ...latest, action: 'uncertain' } : latest
        );
    }
  }
  const status =
    state.action === 'prepared'
      ? 'Prepared only. Not refunded. Collection paused; interest unresolved and provider dispatch unavailable.'
      : state.action === 'uncertain'
        ? 'Preparation could not be confirmed. Reservation may be retained. Refresh authoritative status; do not resubmit.'
        : state.action === 'pending'
          ? 'Preparing cancellation. No refund is being executed.'
          : 'Review the server quote before preparing cancellation.';
  const confirmationLabel =
    'I accept cancellation preparation for these exact amounts and terms, including the interest-forfeiture policy. I understand no refund is executed.';
  return (
    <View
      style={[
        styles.section,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        Review cancellation preparation
      </Text>
      <Text style={{ color: colors.text }}>
        Staging only. This does not refund money. Provider dispatch is
        unavailable; interest disposition remains unresolved.
      </Text>
      {quote ? (
        <>
          <Text style={{ color: colors.text }}>
            Principal: {money(quote.principalKobo)}
          </Text>
          <Text style={{ color: colors.text }}>
            Paid interest: {money(quote.paidInterestKobo)}
          </Text>
          <Text style={{ color: colors.text }}>
            Pending interest: {money(quote.pendingInterestKobo)}
          </Text>
          <Text style={{ color: colors.text }}>
            Cancellation fee: 0% under policy {quote.consentVersion}.
          </Text>
          <Text style={{ color: colors.text }}>
            Paid and pending interest are excluded from the principal quote. No
            interest has been forfeited or released by this screen.
          </Text>
          <Text style={{ color: colors.text }}>
            Terms version: {quote.termsVersion}
          </Text>
          <Text style={{ color: colors.text }}>
            Terms hash: {quote.termsHash}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={confirmationLabel}
            accessibilityState={{ checked: state.checked, disabled: blocked }}
            disabled={blocked}
            onPress={() =>
              setState((latest) => ({ ...latest, checked: !latest.checked }))
            }
            style={[
              styles.control,
              { borderColor: colors.border },
              blocked && styles.disabled,
            ]}
          >
            <Text style={{ color: colors.text }}>
              {state.checked ? '☑' : '☐'} {confirmationLabel}
            </Text>
          </Pressable>
        </>
      ) : (
        <Text style={{ color: colors.text }}>
          A validated server cancellation quote is unavailable.
        </Text>
      )}
      <Text
        testID="cancellation-status"
        accessibilityLiveRegion="polite"
        style={{ color: colors.text }}
      >
        {status}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Prepare cancellation"
        accessibilityState={{
          disabled: blocked || !state.checked,
          busy: state.action === 'pending',
        }}
        disabled={blocked || !state.checked}
        onPress={() => void prepare()}
        style={[
          styles.control,
          { borderColor: colors.primary },
          (blocked || !state.checked) && styles.disabled,
        ]}
      >
        <Text style={{ color: colors.primary }}>Prepare cancellation</Text>
      </Pressable>
    </View>
  );
}
