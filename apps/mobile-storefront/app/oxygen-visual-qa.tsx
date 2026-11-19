import { Redirect } from 'expo-router';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { OxygenVisualQaRoute } from '../components/oxygen-preview/visual-qa-route';

export default function OxygenVisualQaScreen() {
  if (!OxygenVisualQaRoute) return <Redirect href="/" />;
  return (
    <StorefrontScreenShell edges={[]} themeBackground>
      <OxygenVisualQaRoute />
    </StorefrontScreenShell>
  );
}
