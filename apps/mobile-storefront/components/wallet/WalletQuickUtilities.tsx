import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { styles } from './wallet.styles';

type UtilityRoute =
  | '/utilities/airtime'
  | '/utilities/data'
  | '/utilities/power'
  | '/utilities/tv'
  | '/utilities/gaming';

interface WalletQuickUtility {
  accessibilityLabel: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  route: UtilityRoute;
}

const QUICK_UTILITIES: readonly WalletQuickUtility[] = [
  {
    accessibilityLabel: 'Buy Airtime',
    icon: 'call-outline',
    label: 'Airtime',
    route: '/utilities/airtime',
  },
  {
    accessibilityLabel: 'Buy Data',
    icon: 'wifi',
    label: 'Data',
    route: '/utilities/data',
  },
  {
    accessibilityLabel: 'Pay Power Bill',
    icon: 'flash-outline',
    label: 'Power',
    route: '/utilities/power',
  },
  {
    accessibilityLabel: 'Pay TV Bill',
    icon: 'tv-outline',
    label: 'Cable TV',
    route: '/utilities/tv',
  },
  {
    accessibilityLabel: 'Pay Gaming Bill',
    icon: 'game-controller-outline',
    label: 'Gaming',
    route: '/utilities/gaming',
  },
];

interface WalletQuickUtilitiesProps {
  accentColor: string;
}

export function WalletQuickUtilities({
  accentColor,
}: WalletQuickUtilitiesProps) {
  return (
    <>
      <View style={styles.utilityPillsDivider} />
      <Text style={styles.utilityPillsLabel}>Quick Utilities</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.utilityPillsScroll}
      >
        {QUICK_UTILITIES.map((utility) => (
          <Pressable
            key={utility.route}
            accessibilityRole="button"
            accessibilityLabel={utility.accessibilityLabel}
            style={styles.utilityPill}
            onPress={() => router.push(utility.route)}
          >
            <Ionicons name={utility.icon} size={17} color={accentColor} />
            <Text style={styles.utilityPillText}>{utility.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}
