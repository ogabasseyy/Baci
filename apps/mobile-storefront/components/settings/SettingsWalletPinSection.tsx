import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SettingsCardSection } from './SettingsCardSection';
import { SettingsSectionRow } from './SettingsSectionRow';
import {
  useWalletPinSettingsGate,
  type WalletPinStatus,
} from './use-wallet-pin-settings-gate';

function subtitleFor(status: WalletPinStatus | null) {
  if (status?.resetRequired) return 'Reset your PIN to continue';
  if (status?.hasPin) return 'Protects money leaving your wallet';
  return 'Set a PIN to protect money leaving your wallet';
}

/** Settings > SECURITY > Wallet PIN. Renders nothing unless the server says
 *  this customer's PiggyVest wallet is ready, so legacy users see no change. */
export function SettingsWalletPinSection() {
  const colors = Colors[useColorScheme()];
  const gate = useWalletPinSettingsGate();
  if (gate.state !== 'ready') return null;

  return (
    <SettingsCardSection
      cardBackgroundColor={colors.card}
      cardBorderColor={colors.border}
      title="SECURITY"
      titleColor={colors.textSecondary}
      delay={250}
    >
      <SettingsSectionRow
        accessibilityRole="button"
        icon="lock-closed-outline"
        iconBackgroundColor={`${colors.textSecondary}15`}
        iconColor={colors.textSecondary}
        label="Wallet PIN"
        labelColor={colors.text}
        subtitle={subtitleFor(gate.status)}
        subtitleColor={colors.textSecondary}
        onPress={() => router.push('/settings/wallet-pin')}
        right={
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        }
      />
    </SettingsCardSection>
  );
}
