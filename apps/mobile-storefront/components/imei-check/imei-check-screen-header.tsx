import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

export type ImeiCheckStep = 'pick' | 'report';

const TITLES: Record<ImeiCheckStep, string> = {
  pick: 'IMEI Checker',
  report: 'IMEI Report',
};

/**
 * The IMEI checker's one navigation header. The screen owns it for every
 * step, so leaving a report always puts "IMEI Checker" back (a header set by
 * the report itself outlived it). On a report, back returns to the checker
 * (the report is a render of this route, so router.back() would leave it).
 */
export function ImeiCheckScreenHeader({
  step = 'pick',
  textColor,
  onBackFromReport,
}: {
  step?: ImeiCheckStep;
  textColor: string;
  onBackFromReport?: () => void;
}) {
  const onReport = step === 'report' && onBackFromReport !== undefined;
  return (
    <Stack.Screen
      options={{
        title: TITLES[step],
        headerLeft: () => (
          <Pressable
            accessibilityHint={
              onReport
                ? 'Returns to the IMEI checker'
                : 'Returns to the previous screen'
            }
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onReport ? onBackFromReport : () => router.back()}
          >
            {/* The wallet screens' chevron, so back looks the same (Fable). */}
            <Ionicons name="chevron-back" size={26} color={textColor} />
          </Pressable>
        ),
      }}
    />
  );
}
