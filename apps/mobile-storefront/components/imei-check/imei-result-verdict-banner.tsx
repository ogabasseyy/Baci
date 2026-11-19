import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { getVerdictColors, type ImeiVerdictType } from './get-verdict-colors';
import type { ImeiCheckerColors } from './imei-check.types';
import { reportStyles as styles } from './imei-check-report.styles';

const VERDICT_LOOK: Record<
  ImeiVerdictType,
  { headline: string; icon: IoniconsIconName }
> = {
  safe: { headline: 'Looks safe to buy', icon: 'shield-checkmark' },
  caution: { headline: 'Check before you buy', icon: 'alert-circle' },
  danger: { headline: 'Do not buy yet', icon: 'close-circle' },
};

/**
 * The report's first answer: the verdict, coloured by what it means (green
 * safe, amber caution, red danger), with the trust score beside it.
 */
export function ImeiResultVerdictBanner({
  colors,
  score,
  text,
  type,
}: {
  colors: ImeiCheckerColors;
  score: number;
  text: string;
  type: ImeiVerdictType;
}) {
  const palette = getVerdictColors(type, colors);
  const look = VERDICT_LOOK[type];
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.verdict,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={styles.verdictTop}>
        <Ionicons name={look.icon} size={26} color={palette.text} />
        <Text
          accessibilityRole="header"
          style={[styles.verdictHeadline, { color: palette.text }]}
        >
          {look.headline}
        </Text>
        <View
          accessibilityLabel={`Trust score ${score}%`}
          style={[styles.score, { backgroundColor: colors.card }]}
        >
          <Text style={[styles.scoreValue, { color: palette.text }]}>
            {`${score}%`}
          </Text>
          <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>
            Trust
          </Text>
        </View>
      </View>
      <Text style={[styles.verdictBody, { color: colors.text }]}>{text}</Text>
    </View>
  );
}
