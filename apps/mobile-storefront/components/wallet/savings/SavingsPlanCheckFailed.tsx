import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

const twoDigits = (value: number) => String(value).padStart(2, '0');
/** 24-hour HH:MM, like the rest of the savings screens. */
const clockTime = (date: Date) =>
  `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;

/**
 * The plan status could not be read. Try again shows "Checking…" (and is
 * disabled) while the new read runs, and every failed try updates the
 * "Last tried" time, so a repeat failure is visibly a new answer.
 */
export function SavingsPlanCheckFailed({
  colors,
  onTryAgain,
}: {
  colors: (typeof Colors)['light'];
  onTryAgain: () => Promise<unknown>;
}) {
  const [checking, setChecking] = useState(false);
  const [lastTried, setLastTried] = useState(() => new Date());
  const tryAgain = () => {
    if (checking) return;
    setChecking(true);
    let read: unknown;
    try {
      read = onTryAgain();
    } catch {
      read = undefined;
    }
    void Promise.resolve(read)
      .catch(() => undefined)
      .finally(() => {
        // Still on screen means the read failed again.
        setChecking(false);
        setLastTried(new Date());
      });
  };
  return (
    <View style={styles.section}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        We couldn’t check on your plan just now. Check your connection and try
        again.
      </Text>
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        Last tried {clockTime(lastTried)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={checking ? 'Checking' : 'Try again'}
        accessibilityState={{ disabled: checking, busy: checking }}
        disabled={checking}
        onPress={tryAgain}
        style={styles.retry}
      >
        <Text style={[styles.action, { color: colors.primary }]}>
          {checking ? 'Checking…' : 'Try again'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  body: { fontSize: 13, lineHeight: 21 },
  note: { fontSize: 11 },
  action: { fontSize: 13, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
