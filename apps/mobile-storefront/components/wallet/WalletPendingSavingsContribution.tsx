import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

/** How often, and how many times, the card re-checks a pending contribution. */
const AUTO_CHECK_MS = 5000;
const AUTO_CHECKS = 6;

export function WalletPendingSavingsContribution({
  colors,
  isChecking,
  onCheck,
}: {
  colors: (typeof Colors)['light'];
  isChecking: boolean;
  onCheck: () => unknown;
}) {
  // While it shows, the card asks again by itself a few times (status reads
  // only, never a new payment), so a transfer PiggyVest confirms a little
  // later settles without the customer tapping again and again.
  const checks = useRef(0);
  // The parent's handler is a new function on every render; only a finished
  // check (isChecking going false) restarts the wait.
  const check = useRef(onCheck);
  check.current = onCheck;
  // One status read at a time: a tap and the timer firing together must not
  // start two reads that race on the same operation and notice.
  const inFlight = useRef(false);
  // Reads refs only, so it is stable across renders (the timer effect uses it).
  const runCheck = useRef(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    let result: unknown;
    try {
      result = check.current();
    } catch {
      inFlight.current = false;
      return;
    }
    // A synchronous handler is done at once; a promise holds the guard.
    if (
      typeof result !== 'object' ||
      result === null ||
      typeof (result as { then?: unknown }).then !== 'function'
    ) {
      inFlight.current = false;
      return;
    }
    void (result as Promise<unknown>)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }).current;
  useEffect(() => {
    if (isChecking || checks.current >= AUTO_CHECKS) return;
    const timer = setTimeout(() => {
      checks.current += 1;
      runCheck();
    }, AUTO_CHECK_MS);
    return () => clearTimeout(timer);
  }, [isChecking, runCheck]);
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.textSecondary }}>
        Your contribution is awaiting confirmation. We'll keep checking; you can
        also check now before starting another payment.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check contribution status"
        accessibilityState={{ disabled: isChecking, busy: isChecking }}
        disabled={isChecking}
        onPress={runCheck}
        style={{
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.primary,
        }}
      >
        <Text style={{ color: colors.primary, textAlign: 'center' }}>
          {isChecking ? 'Checking contribution…' : 'Check contribution status'}
        </Text>
      </Pressable>
    </View>
  );
}
