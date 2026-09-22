import type { MobileStoreReadiness } from '@baci/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { STORE_SETUP_COMPLETE_PROGRESS } from '@/constants/store-readiness';
import { SPACING } from '@/constants/theme';
import { ProgressCard } from './ProgressCard';

interface StoreSetupStatusCardProps {
  isLive: boolean;
  isLoading: boolean;
  readiness: MobileStoreReadiness | null | undefined;
}

export function StoreSetupStatusCard({
  isLive,
  isLoading,
  readiness,
}: StoreSetupStatusCardProps) {
  if (isLoading || !readiness) {
    return null;
  }

  const isRequiredSetupIncomplete = !readiness.isReady;
  if (
    !isRequiredSetupIncomplete &&
    isLive &&
    readiness.overallProgress >= STORE_SETUP_COMPLETE_PROGRESS
  ) {
    return null;
  }

  const title = isRequiredSetupIncomplete
    ? 'Finish Setup'
    : 'Finish setting up your store';
  const subtitle = isRequiredSetupIncomplete
    ? 'Complete your store setup to start selling'
    : isLive
      ? 'Complete the remaining optional steps to get the most from your store.'
      : 'Your store is ready to launch. Finish the extras or publish now.';

  return (
    <View style={styles.section}>
      <ProgressCard
        title={title}
        subtitle={subtitle}
        progress={readiness.overallProgress}
        onPress={() => router.push('/(admin)/setup-checklist')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
});
