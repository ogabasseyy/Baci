import type { ImeiServiceTierDefinition } from '@baci/shared/imei';
import {
  canAssessImeiNetworkUnlock,
  getImeiBlacklistState,
  getImeiEffectiveVerdict,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, SPACING, withAlpha } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { ImeiResult } from '@/lib/validation';
import { getVerdictColors } from './get-verdict-colors';
import { ImeiBlacklistCheckAction } from './imei-blacklist-check-action';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';
import { ImeiCheckPending } from './imei-check-pending';
import { getImeiResultStatusCards } from './imei-check-result-status-cards';
import { ImeiRemediationOffer } from './imei-remediation-offer';
import { ImeiResultStatusCard } from './imei-result-status-card';

interface ImeiCheckResultViewProps {
  accessToken?: string;
  apiBaseUrl?: string;
  colors: ImeiCheckerColors;
  currentTier: ImeiServiceTierDefinition;
  lookupId?: string | null;
  result: ImeiResult;
  onReset: () => void;
  onCheckBlacklist?: () => void;
  isChecking?: boolean;
  checkError?: string | null;
  pendingPaused?: boolean;
  canResume?: boolean;
}

export function ImeiCheckResultView({
  accessToken,
  apiBaseUrl,
  colors,
  currentTier,
  lookupId,
  result,
  onReset,
  onCheckBlacklist,
  isChecking = false,
  checkError,
  pendingPaused = false,
  canResume = true,
}: ImeiCheckResultViewProps) {
  const insets = useSafeAreaInsets();
  const effectiveVerdict = getImeiEffectiveVerdict(result);
  const verdictColors = getVerdictColors(effectiveVerdict.type, colors);
  const statusCards = getImeiResultStatusCards(
    result,
    colors,
    currentTier.checksIncluded
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'IMEI Results',
          headerLeft: () => (
            <Pressable
              accessibilityHint="Returns to the IMEI checker"
              accessibilityLabel="Back"
              accessibilityRole="button"
              // Back = leave the result, not the checker: the result is a
              // conditional render on this route, so router.back() would pop
              // the whole screen and land on home.
              onPress={onReset}
              disabled={isChecking}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + SPACING.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.resultHeader,
            { backgroundColor: colors.card, borderColor: verdictColors.border },
          ]}
        >
          <DeviceImage result={result} colors={colors} />
          <View style={styles.deviceInfo}>
            <Text style={[styles.tierBadge, { color: colors.textSecondary }]}>
              {currentTier.name}
            </Text>
            <Text style={[styles.deviceName, { color: colors.text }]}>
              {result.deviceProfile?.model ?? result.device}
            </Text>
            {result.deviceProfile && (
              <>
                {(result.deviceProfile.color ||
                  result.deviceProfile.storage) && (
                  <Text
                    style={[styles.imeiText, { color: colors.textSecondary }]}
                  >
                    {[result.deviceProfile.color, result.deviceProfile.storage]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
                {result.deviceProfile.imageMatch !== 'none' && (
                  <Text
                    style={[styles.imeiText, { color: colors.textSecondary }]}
                  >
                    {result.deviceProfile.imageMatch === 'color' &&
                    result.deviceProfile.color
                      ? `Catalog illustration · ${result.deviceProfile.color}`
                      : 'Model illustration · colour may differ'}
                  </Text>
                )}
              </>
            )}
            <Text style={[styles.imeiText, { color: colors.textSecondary }]}>
              IMEI: {result.imei}
            </Text>
            {result.modelNumber && (
              <Text style={[styles.modelText, { color: colors.textSecondary }]}>
                Model: {result.modelNumber}
              </Text>
            )}
          </View>
          <TrustScore result={result} colors={colors} />
        </View>

        <View style={styles.statusGrid}>
          {statusCards.map((card) => (
            <ImeiResultStatusCard key={card.label} colors={colors} {...card} />
          ))}
        </View>

        <View
          style={[
            styles.verdictContainer,
            {
              backgroundColor: verdictColors.bg,
              borderColor: verdictColors.border,
            },
          ]}
        >
          <Text style={[styles.verdictText, { color: verdictColors.text }]}>
            {effectiveVerdict.text}
          </Text>
        </View>

        {onCheckBlacklist &&
        !currentTier.checksIncluded.includes('blacklistStatus') &&
        isValidDeviceIdentifier(result.imei, 'imei') &&
        getImeiBlacklistState(result.blacklistStatus) === 'unknown' ? (
          <ImeiBlacklistCheckAction
            isChecking={isChecking}
            onCheck={onCheckBlacklist}
          />
        ) : null}
        {isChecking ? (
          <ImeiCheckPending
            colors={colors}
            paused={pendingPaused}
            canResume={canResume}
          />
        ) : null}
        {checkError ? (
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {checkError}
          </Text>
        ) : null}
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
          style={[
            styles.resetButton,
            {
              backgroundColor: withAlpha(BRAND.primary, 0.06),
              borderColor: withAlpha(BRAND.primary, 0.18),
            },
          ]}
          onPress={onReset}
          disabled={isChecking}
        >
          <Ionicons name="scan-outline" size={18} color={BRAND.primary} />
          <Text style={[styles.resetButtonText, { color: BRAND.primary }]}>
            Check Another Device
          </Text>
        </Pressable>
      </ScrollView>
    </View>
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
    <View style={styles.deviceImageContainer}>
      {result.deviceImage ? (
        <Image
          source={createSafeBoundedImageSource({
            height: 60,
            uri: result.deviceImage,
            width: 60,
          })}
          style={styles.deviceImage}
          contentFit="contain"
        />
      ) : (
        <Ionicons
          name="phone-portrait-outline"
          size={48}
          color={colors.textSecondary}
        />
      )}
    </View>
  );
}

function TrustScore({
  colors,
  result,
}: {
  colors: ImeiCheckerColors;
  result: ImeiResult;
}) {
  const palette = getVerdictColors(
    getImeiEffectiveVerdict(result).type,
    colors
  );

  return (
    <View style={[styles.scoreContainer, { backgroundColor: palette.bg }]}>
      <Text style={[styles.scoreValue, { color: palette.text }]}>
        {result.score}%
      </Text>
      <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>
        Trust
      </Text>
    </View>
  );
}
