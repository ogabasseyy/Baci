import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { withAlpha } from '@/constants/Colors';
import { getVerdictColors } from './get-verdict-colors';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';
import { isStatusClean } from './is-status-clean';
export function ImeiResultStatusCard({
  cleanAware = false,
  colors,
  icon,
  label,
  tint,
  value,
}: {
  cleanAware?: boolean;
  colors: ImeiCheckerColors;
  icon: IoniconsIconName;
  label: string;
  tint?: string;
  value: string;
}) {
  const clean = isStatusClean(value);
  const cleanPalette = getVerdictColors('safe', colors);
  const dangerPalette = getVerdictColors('danger', colors);
  const color = cleanAware
    ? clean
      ? cleanPalette.text
      : dangerPalette.text
    : tint || colors.text;
  const backgroundColor = cleanAware
    ? clean
      ? cleanPalette.bg
      : dangerPalette.bg
    : withAlpha(color, 0.12);

  return (
    <View
      style={[
        styles.statusCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.statusIcon, { backgroundColor }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.statusInfo}>
        <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>
          {label}
        </Text>
        <Text style={[styles.statusValue, { color }]}>{value}</Text>
      </View>
    </View>
  );
}
