import { Stack, useLocalSearchParams } from 'expo-router';
import { previewSteps } from '@/components/oxygen-preview/fixtures';
import { OxygenPreview } from '@/components/oxygen-preview/OxygenPreview';

// The synthetic iOS preview is tied to the local fixture server.
const OXYGEN_VISUAL_QA_ORIGIN = 'http://127.0.0.1:3198';

export default function OxygenVisualQaRoute() {
  const { step } = useLocalSearchParams<{ step?: string }>();
  if (
    !__DEV__ ||
    process.env.EXPO_PUBLIC_OXYGEN_STAGING !== '1' ||
    process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN !== OXYGEN_VISUAL_QA_ORIGIN
  ) {
    return null;
  }
  const initial = previewSteps.find((value) => value === step) ?? 'identity';
  return (
    <>
      <Stack.Screen options={{ title: 'Oxygen preview', headerShown: true }} />
      <OxygenPreview key={initial} initial={initial} />
    </>
  );
}
