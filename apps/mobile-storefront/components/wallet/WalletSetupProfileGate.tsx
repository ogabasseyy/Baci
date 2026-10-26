import type { ReactNode } from 'react';
import { Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';
import { WalletFundPhonePrompt } from './WalletFundPhonePrompt';
import { WalletSetupNameForm } from './WalletSetupNameForm';

export function WalletSetupProfileGate({
  colors,
  merchantId,
  children,
}: {
  colors: (typeof Colors)['light'];
  merchantId: string;
  children: ReactNode;
}) {
  const customer = useAuthStore((state) => state.customer);
  const activeMerchant = useAuthStore((state) => state.merchantId);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  if (!customer || activeMerchant !== merchantId)
    return (
      <Text style={{ color: colors.textSecondary }}>Loading your profile…</Text>
    );
  if (!customer.first_name?.trim() || !customer.last_name?.trim())
    return (
      <WalletSetupNameForm
        key={customer.id}
        colors={colors}
        firstName={customer.first_name}
        lastName={customer.last_name}
        onSave={updateProfile}
      />
    );
  if (!customer.phone?.trim())
    return (
      <WalletFundPhonePrompt
        key={customer.id}
        colors={colors}
        onSubmit={(phone) => updateProfile({ phone })}
      />
    );
  return <>{children}</>;
}
