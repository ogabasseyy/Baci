import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';

type Props = {
  icon: ComponentProps<typeof Ionicons>['name'];
  text: string;
  color: string;
  /** "label" is a bold question; "note" is a small supporting line. */
  variant?: 'label' | 'note';
};

/** A brand-red icon in a soft tinted circle, followed by a line of text. */
export function SavingsIconLabel({
  icon,
  text,
  color,
  variant = 'label',
}: Props) {
  const label = variant === 'label';
  return (
    <View style={styles.row}>
      <View style={[styles.circle, label ? styles.circleLabel : null]}>
        <Ionicons name={icon} size={label ? 15 : 13} color={BRAND.primary} />
      </View>
      <Text style={[label ? styles.label : styles.note, { color }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleLabel: { width: 28, height: 28, borderRadius: 14 },
  label: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  note: { flex: 1, fontSize: 12, lineHeight: 18 },
});
