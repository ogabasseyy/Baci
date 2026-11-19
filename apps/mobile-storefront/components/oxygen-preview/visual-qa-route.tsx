import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { OxygenPreview, previewSteps } from './entry';

// Plain HTTP is only for the exact loopback fixture server in development.
const OXYGEN_VISUAL_QA_ORIGIN = 'http://127.0.0.1:3198';

export function OxygenVisualQaRoute() {
  const { step } = useLocalSearchParams<{ step?: string | string[] }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (
    process.env.EXPO_PUBLIC_OXYGEN_STAGING !== '1' ||
    process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN !== OXYGEN_VISUAL_QA_ORIGIN
  ) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text>
          Oxygen preview requires the local iOS fixture server and staging
          profile.
        </Text>
      </View>
    );
  }
  return <OxygenVisualQaFixture step={step} />;
}

export function OxygenVisualQaFixture({ step }: { step?: string | string[] }) {
  const initial = previewSteps.find((value) => value === (step ?? 'identity'));
  if (!initial) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text accessibilityRole="alert">Unknown Oxygen preview step.</Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Oxygen preview', headerShown: true }} />
      <OxygenPreview key={initial} initial={initial} />
    </>
  );
}
