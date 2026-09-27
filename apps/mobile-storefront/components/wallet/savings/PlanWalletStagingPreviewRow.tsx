import { Text, View } from 'react-native';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

interface PlanWalletStagingPreviewRowProps {
  colors: StartSavingsColors;
  label: string;
  value: string;
}

/**
 * Label/value row for the staging-only plan-wallet preview. Extracted from
 * PlanWalletStagingSection to keep one component per module.
 */
export function PlanWalletStagingPreviewRow({
  colors,
  label,
  value,
}: PlanWalletStagingPreviewRowProps) {
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
    >
      <Text
        style={[
          styles.sourceModeHint,
          { color: colors.textSecondary, flex: 1 },
        ]}
      >
        {label}
      </Text>
      <Text style={[styles.sourceModeHint, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}
