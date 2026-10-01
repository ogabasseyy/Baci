import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { getMerchantSetupStyles } from './merchant-setup.styles';

interface MerchantSetupProgressProps {
  onAboutYouPress?: () => void;
  step: 1 | 2;
}

export function MerchantSetupProgress({
  onAboutYouPress,
  step,
}: MerchantSetupProgressProps) {
  const { colors } = useTheme();
  const styles = getMerchantSetupStyles(colors);

  return (
    <View
      accessibilityLabel={`Setup progress: step ${step} of 2`}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: 2, now: step }}
      style={styles.progressCard}
    >
      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>Your store setup</Text>
        <Text style={styles.progressCount}>{step} of 2</Text>
      </View>
      <View style={styles.stageTrack}>
        <Pressable
          accessibilityLabel="About you"
          accessibilityRole="button"
          disabled={step !== 2 || !onAboutYouPress}
          onPress={onAboutYouPress}
          style={styles.stage}
        >
          <View style={[styles.stageDot, styles.stageDotActive]}>
            {step === 2 ? (
              <Ionicons
                color={colors.textOnPrimary}
                name="checkmark"
                size={16}
              />
            ) : (
              <Text style={[styles.stageNumber, styles.stageNumberActive]}>
                1
              </Text>
            )}
          </View>
          <Text style={[styles.stageLabel, styles.stageLabelActive]}>
            About you
          </Text>
        </Pressable>
        <View style={styles.stageConnector}>
          {step === 2 ? <View style={styles.stageConnectorComplete} /> : null}
        </View>
        <View style={styles.stage}>
          <View style={[styles.stageDot, step === 2 && styles.stageDotActive]}>
            <Text
              style={[
                styles.stageNumber,
                step === 2 && styles.stageNumberActive,
              ]}
            >
              2
            </Text>
          </View>
          <Text
            style={[styles.stageLabel, step === 2 && styles.stageLabelActive]}
          >
            Your business
          </Text>
        </View>
      </View>
    </View>
  );
}
