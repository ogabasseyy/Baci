import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { getMerchantSetupStyles } from './merchant-setup.styles';

interface MerchantSetupHeroProps {
  firstName?: string;
  onBack?: () => void;
  ownerFocus?: 'identity' | 'location';
  step: 'owner' | 'business';
}

export function MerchantSetupHero({
  firstName = '',
  onBack,
  ownerFocus = 'identity',
  step,
}: MerchantSetupHeroProps) {
  const { colors, isDark } = useTheme();
  const styles = getMerchantSetupStyles(colors);
  const isBusinessStep = step === 'business';
  const isLocationOwnerStep = !isBusinessStep && ownerFocus === 'location';
  const gradientColors = isDark
    ? (['rgba(74,144,217,0.22)', 'rgba(240,191,88,0.07)'] as const)
    : (['#EFF6FF', '#FFFBEB'] as const);

  return (
    <View style={styles.hero}>
      <LinearGradient
        colors={gradientColors}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.heroGradient}
      >
        <View style={styles.heroEyebrowRow}>
          <View style={styles.heroIcon}>
            <Ionicons
              color={colors.gold}
              name={isBusinessStep ? 'storefront-outline' : 'person-outline'}
              size={20}
            />
          </View>
          <Text style={styles.heroEyebrow}>
            {isBusinessStep ? 'FINAL STEP' : 'YOUR STORE STARTS HERE'}
          </Text>
        </View>
        <Text style={styles.heroTitle}>
          {isBusinessStep
            ? `Welcome${firstName ? `, ${firstName}` : ''}!`
            : isLocationOwnerStep
              ? 'Where is your business?'
              : "Let's get to know you"}
        </Text>
        <Text style={styles.heroText}>
          {isBusinessStep
            ? 'Add your business details to launch your store.'
            : isLocationOwnerStep
              ? 'Choose your country so we can set currency and local payment options.'
              : 'Tell us who you are so we can personalize your store and local settings.'}
        </Text>
        {isBusinessStep && onBack ? (
          <Pressable
            accessibilityLabel="Back to about you"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.heroBack}
          >
            <Ionicons color={colors.primary} name="arrow-back" size={16} />
            <Text style={styles.heroBackText}>Back to about you</Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}
