import { getImeiBlacklistState } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { withAlpha } from '@/constants/Colors';
import { getVerdictColors, type ImeiVerdictType } from './get-verdict-colors';
import type { ImeiCheckerColors } from './imei-check.types';
import { reportStyles as styles } from './imei-check-report.styles';
import type { ImeiResultStatusCard } from './imei-check-result-status-cards';
import { isStatusClean } from './is-status-clean';

/**
 * How a finding reads. Only pass/fail findings (blacklist, iCloud, MDM...)
 * get a colour: green when clean, red when not, amber when the report could
 * not tell. Facts such as warranty, dates or country stay neutral, so "Out
 * Of Warranty" is never painted as good news.
 */
export function imeiStatusTone(
  card: Pick<ImeiResultStatusCard, 'blacklist' | 'cleanAware' | 'value'>
): ImeiVerdictType | 'neutral' {
  if (card.blacklist) {
    const state = getImeiBlacklistState(card.value);
    return state === 'clean' ? 'safe' : state === 'risk' ? 'danger' : 'caution';
  }
  if (!card.cleanAware) return 'neutral';
  if (card.value.trim().toLowerCase() === 'unknown') return 'caution';
  return isStatusClean(card.value) ? 'safe' : 'danger';
}

/** Every finding of the report in one list card, coloured by meaning. */
export function ImeiResultStatusList({
  cards,
  colors,
}: {
  cards: readonly ImeiResultStatusCard[];
  colors: ImeiCheckerColors;
}) {
  if (cards.length === 0) return null;
  return (
    <View
      style={[
        styles.list,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {cards.map((card, index) => {
        const tone = imeiStatusTone(card);
        const palette =
          tone === 'neutral' ? null : getVerdictColors(tone, colors);
        const iconColor = palette?.text ?? colors.textSecondary;
        return (
          <View
            key={card.label}
            testID={`imei-status-${tone}`}
            style={[
              styles.row,
              index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
            ]}
          >
            <View
              style={[
                styles.rowIcon,
                {
                  backgroundColor:
                    palette?.bg ?? withAlpha(colors.textSecondary, 0.12),
                },
              ]}
            >
              <Ionicons name={card.icon} size={17} color={iconColor} />
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>
                {card.label}
              </Text>
              <Text
                style={[
                  styles.rowValue,
                  { color: palette?.text ?? colors.text },
                ]}
              >
                {card.value}
              </Text>
            </View>
            {palette ? (
              <Ionicons
                name={
                  tone === 'safe'
                    ? 'checkmark-circle'
                    : tone === 'danger'
                      ? 'close-circle'
                      : 'help-circle'
                }
                size={18}
                color={palette.text}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
