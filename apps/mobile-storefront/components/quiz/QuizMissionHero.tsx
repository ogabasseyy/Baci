import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

const SUPERQUIZ_SPONSOR_EMAIL =
  'mailto:support@ogabassey.com?subject=SuperQuiz%20Sponsorship';

export function QuizMissionHero() {
  const { colors, isDark } = useTheme();
  const styles = createStyles(
    colors.primary,
    colors.primaryForeground,
    colors.text
  );

  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={
          isDark
            ? ['#3A080C', '#1B1012', '#111315']
            : ['#FFF0F1', '#FFFFFF', '#FFF8F2']
        }
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.gradient}
      >
        <View style={styles.topline}>
          <View style={styles.kicker}>
            <Ionicons
              color={colors.primaryForeground}
              name="sparkles"
              size={13}
            />
            <Text style={styles.kickerText}>OGABASSEY&apos;S SUPERQUIZ</Text>
          </View>
          <View style={styles.iconHalo}>
            <Ionicons color={colors.primary} name="trophy" size={25} />
          </View>
        </View>

        <Text accessibilityRole="header" style={styles.headline}>
          Play for more than the prize.
        </Text>
        <Text style={[styles.story, { color: colors.textSecondary }]}>
          We&apos;re putting smartphones within reach of more Nigerians so more
          people can learn, earn and connect.
        </Text>

        <View
          accessibilityLabel="Learn, earn, connect"
          style={styles.impactRow}
        >
          <View style={styles.impactChip}>
            <Text style={[styles.impactText, { color: colors.text }]}>
              LEARN
            </Text>
          </View>
          <View style={styles.impactChip}>
            <Text style={[styles.impactText, { color: colors.text }]}>
              EARN
            </Text>
          </View>
          <View style={styles.impactChip}>
            <Text style={[styles.impactText, { color: colors.text }]}>
              CONNECT
            </Text>
          </View>
        </View>

        <Text style={[styles.closingLine, { color: colors.textSecondary }]}>
          Together, we can help close the digital divide.
        </Text>

        <View style={styles.sponsorButtonBox}>
          <Pressable
            accessibilityLabel="Sponsor SuperQuiz"
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(SUPERQUIZ_SPONSOR_EMAIL).catch(
                () => undefined
              );
            }}
            style={styles.sponsorButton}
          >
            <Text style={styles.sponsorButtonText}>Sponsor SuperQuiz</Text>
            <Ionicons color={colors.primary} name="arrow-forward" size={16} />
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function createStyles(
  primary: string,
  primaryForeground: string,
  text: string
) {
  return StyleSheet.create({
    shell: {
      borderColor: 'rgba(218, 44, 56, 0.45)',
      borderRadius: 24,
      borderWidth: 1,
      overflow: 'hidden',
    },
    gradient: { gap: 13, padding: 20 },
    topline: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    kicker: {
      alignItems: 'center',
      backgroundColor: primary,
      borderRadius: 999,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    kickerText: {
      color: primaryForeground,
      fontFamily: 'Inter_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    iconHalo: {
      alignItems: 'center',
      backgroundColor: 'rgba(218, 44, 56, 0.12)',
      borderRadius: 999,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    headline: {
      color: text,
      fontFamily: 'Inter_900Black',
      fontSize: 28,
      letterSpacing: -0.7,
      lineHeight: 32,
      maxWidth: '88%',
    },
    story: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 20,
    },
    impactRow: { flexDirection: 'row', gap: 8 },
    impactChip: {
      backgroundColor: 'rgba(255, 255, 255, 0.07)',
      borderColor: 'rgba(218, 44, 56, 0.3)',
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    impactText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    closingLine: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      lineHeight: 17,
    },
    sponsorButtonBox: {
      alignSelf: 'flex-start',
    },
    sponsorButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      paddingVertical: 5,
    },
    sponsorButtonText: {
      color: primary,
      fontFamily: 'Inter_700Bold',
      fontSize: 13,
      textDecorationLine: 'underline',
    },
  });
}
