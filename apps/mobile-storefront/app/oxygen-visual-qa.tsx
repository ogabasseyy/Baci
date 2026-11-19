import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { previewSteps } from '@/components/oxygen-preview/fixtures';
import { OxygenPreview } from '@/components/oxygen-preview/OxygenPreview';
import { Text, View } from '@/components/Themed';

// The synthetic iOS preview is tied to the local fixture server.
const OXYGEN_VISUAL_QA_ORIGIN = 'http://127.0.0.1:3198';

export default function OxygenVisualQaRoute() {
  const { step } = useLocalSearchParams<{ step?: string }>();
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
  const initial = previewSteps.find((value) => value === step) ?? 'identity';
  return (
    <>
      <Stack.Screen options={{ title: 'Oxygen preview', headerShown: true }} />
      <OxygenPreview key={initial} initial={initial} />
    </>
  );
}
