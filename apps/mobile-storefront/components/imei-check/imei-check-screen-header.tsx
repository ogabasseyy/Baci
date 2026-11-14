import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

/** The IMEI checker's navigation header: title and a back button. */
export function ImeiCheckScreenHeader({ textColor }: { textColor: string }) {
  return (
    <Stack.Screen
      options={{
        title: 'IMEI Checker',
        headerLeft: () => (
          <Pressable
            accessibilityHint="Returns to the previous screen"
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
          >
            {/* The wallet screens' chevron, so back looks the same (Fable). */}
            <Ionicons name="chevron-back" size={26} color={textColor} />
          </Pressable>
        ),
      }}
    />
  );
}
