import type { ImeiServiceTierDefinition } from '@baci/shared/imei';
import {
  canAssessImeiNetworkUnlock,
  getImeiEffectiveVerdict,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, SPACING } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { ImeiResult } from '@/lib/validation';
import { ImeiTicketNotch } from './imei-care-look';
import type { ImeiCheckerColors } from './imei-check.types';
import { reportStyles as styles } from './imei-check-report.styles';
import { getImeiResultStatusCards } from './imei-check-result-status-cards';
import { ImeiRemediationOffer } from './imei-remediation-offer';
import { ImeiResultStatusList } from './imei-result-status-list';
import { ImeiResultVerdictBanner } from './imei-result-verdict-banner';

interface ImeiCheckResultViewProps {
  accessToken?: string;
  apiBaseUrl?: string;
  colors: ImeiCheckerColors;
  currentTier: ImeiServiceTierDefinition;
  lookupId?: string | null;
  result: ImeiResult;
  onReset: () => void;
}

/**
 * The report: the verdict first (coloured by what it means), then the
 * device, then every finding in one list. The screen owns the header, so
 * its title and back button follow the step (see ImeiCheckScreenHeader).
 */
export function ImeiCheckResultView({
  accessToken,
  apiBaseUrl,
  colors,
  currentTier,
  lookupId,
  result,
  onReset,
}: ImeiCheckResultViewProps) {
  const insets = useSafeAreaInsets();
  const verdict = getImeiEffectiveVerdict(result);
  const statusCards = getImeiResultStatusCards(
    result,
    colors,
    currentTier.checksIncluded
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + SPACING.lg },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ImeiResultVerdictBanner
        colors={colors}
        score={result.score}
        text={verdict.text}
        type={verdict.type}
      />

      <View
        style={[
          styles.device,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <ImeiTicketNotch colors={colors} />
        <DeviceImage result={result} colors={colors} />
        <View style={styles.deviceInfo}>
          <Text style={[styles.tierName, { color: colors.textSecondary }]}>
            {currentTier.name}
          </Text>
          <Text style={[styles.deviceName, { color: colors.text }]}>
            {result.deviceProfile?.model ?? result.device}
          </Text>
          {result.deviceProfile &&
          (result.deviceProfile.color || result.deviceProfile.storage) ? (
            <Text style={[styles.deviceMeta, { color: colors.textSecondary }]}>
              {[result.deviceProfile.color, result.deviceProfile.storage]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {result.deviceProfile &&
          result.deviceProfile.imageMatch !== 'none' ? (
            <Text style={[styles.deviceMeta, { color: colors.textSecondary }]}>
              {result.deviceProfile.imageMatch === 'color' &&
              result.deviceProfile.color
                ? `Catalog illustration · ${result.deviceProfile.color}`
                : 'Model illustration · colour may differ'}
            </Text>
          ) : null}
          <Text style={[styles.imei, { color: colors.textSecondary }]}>
            IMEI: {result.imei}
          </Text>
          {result.modelNumber ? (
            <Text style={[styles.deviceMeta, { color: colors.textSecondary }]}>
              Model: {result.modelNumber}
            </Text>
          ) : null}
        </View>
      </View>

      {statusCards.length > 0 ? (
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: colors.text }]}
        >
          What we checked
        </Text>
      ) : null}
      <ImeiResultStatusList cards={statusCards} colors={colors} />

      {lookupId && apiBaseUrl && canAssessImeiNetworkUnlock(result) ? (
        <ImeiRemediationOffer
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
          colors={colors}
          identifier={result.imei}
          lookupId={lookupId}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        style={[styles.again, { backgroundColor: BRAND.primary }]}
        onPress={onReset}
      >
        <Ionicons name="scan-outline" size={18} color={BRAND.onPrimary} />
        <Text style={[styles.againText, { color: BRAND.onPrimary }]}>
          Check another device
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function DeviceImage({
  colors,
  result,
}: {
  colors: ImeiCheckerColors;
  result: ImeiResult;
}) {
  return (
    <View style={styles.deviceImageBox}>
      {result.deviceImage ? (
        <Image
          source={createSafeBoundedImageSource({
            height: 56,
            uri: result.deviceImage,
            width: 56,
          })}
          style={styles.deviceImage}
          contentFit="contain"
        />
      ) : (
        <Ionicons
          name="phone-portrait-outline"
          size={40}
          color={colors.textSecondary}
        />
      )}
    </View>
  );
}
