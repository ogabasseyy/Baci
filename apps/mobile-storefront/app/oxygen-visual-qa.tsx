import { Redirect } from 'expo-router';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { OxygenVisualQaRoute } from '../components/oxygen-preview/visual-qa-route';

export default function OxygenVisualQaScreen() {
  // Release Metro builds replace this import with the null preview stub.
  if (!OxygenVisualQaRoute) return <Redirect href="/" />;
  return (
    <StorefrontScreenShell edges={[]} themeBackground>
      <OxygenVisualQaRoute />
    </StorefrontScreenShell>
  );
}
