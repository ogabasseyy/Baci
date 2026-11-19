import { InstallmentInfo } from './PaymentOptionCard';

export function PaymentInstallmentDetails({
  paymentMethod,
}: {
  paymentMethod: string;
}) {
  if (paymentMethod === 'credit_direct') {
    return (
      <InstallmentInfo
        title="How Credit Direct works"
        tone="purple"
        items={['Instant approval decision', 'Pay over 3-6 months', 'No hidden fees', 'Get your items immediately']}
      />
    );
  }
  return null;
}
