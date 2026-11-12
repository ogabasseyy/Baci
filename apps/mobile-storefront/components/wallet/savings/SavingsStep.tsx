import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import type { StartSavingsColors } from './start-savings.types';

export type SavingsStepState = 'done' | 'current' | 'later';

const STATE_LABEL: Record<SavingsStepState, string> = {
  done: 'done',
  current: 'current step',
  later: 'not started',
};

/**
 * One step of the savings setup page. Steps sit on one continuous page,
 * joined by a thin line: done = red tick, current = red outline, later =
 * grey. A later step shows only its title until the steps before it are done.
 */
export function SavingsStep({
  colors,
  number,
  title,
  state,
  last = false,
  children,
}: {
  colors: StartSavingsColors;
  number: number;
  title: string;
  state: SavingsStepState;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[
            styles.circle,
            state === 'done'
              ? styles.circleDone
              : state === 'current'
                ? [styles.circleCurrent, { backgroundColor: colors.background }]
                : { borderColor: colors.border },
          ]}
        >
          {state === 'done' ? (
            <Ionicons name="checkmark" size={16} color={palette.white} />
          ) : (
            <Text
              style={[
                styles.number,
                {
                  color:
                    state === 'current' ? BRAND.primary : colors.textSecondary,
                },
              ]}
            >
              {number}
            </Text>
          )}
        </View>
        {last ? null : (
          <View
            style={[
              styles.line,
              {
                backgroundColor:
                  state === 'done' ? palette.red[200] : colors.border,
              },
            ]}
          />
        )}
      </View>
      <View style={[styles.body, last ? null : styles.bodyGap]}>
        <Text
          accessibilityRole="header"
          accessibilityLabel={`Step ${number}, ${title}, ${STATE_LABEL[state]}`}
          style={[
            styles.title,
            { color: state === 'later' ? colors.textSecondary : colors.text },
          ]}
        >
          {title}
        </Text>
        {state === 'later' ? null : children}
      </View>
    </View>
  );
}

const CIRCLE = 28;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  rail: { width: CIRCLE, alignItems: 'center' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  circleCurrent: { borderColor: BRAND.primary },
  number: { fontSize: 13, fontWeight: '700' },
  line: { flex: 1, width: 2, marginVertical: 4, borderRadius: 1 },
  body: { flex: 1, minWidth: 0, gap: 14 },
  bodyGap: { paddingBottom: 28 },
  title: { fontSize: 16, fontWeight: '700', lineHeight: CIRCLE },
});
