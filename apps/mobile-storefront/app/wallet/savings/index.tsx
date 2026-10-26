import { Stack } from 'expo-router';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { SavingsPlansScreen } from '@/components/wallet/savings/SavingsPlansScreen';

export default function SavingsPlansRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Savings plans' }} />
      <StorefrontScreenShell edges={['bottom']} themeBackground>
        <SavingsPlansScreen />
      </StorefrontScreenShell>
    </>
  );
}
