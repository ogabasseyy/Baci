import { InstallmentInfo } from './PaymentOptionCard';

export function PaymentInstallmentDetails({
  paymentMethod,
}: {
  paymentMethod: string;
}) {
  if (paymentMethod === 'credpal') {
    return (
      <InstallmentInfo
        title="How CredPal works"
        tone="blue"
        items={['Quick approval in minutes', 'Pay over 3-6 months', 'Competitive interest rates', 'Receive your items immediately']}
      />
    );
  }
  if (paymentMethod === 'credit_direct') {
    return (
      <InstallmentInfo
        title="How Credit Direct works"
        tone="purple"
        items={['Instant approval decision', 'Pay over 3-6 months', 'No hidden fees', 'Get your items immediately']}
      />
    );
  }
  if (paymentMethod === 'klump') {
    return (
      <InstallmentInfo
        title="How Klump works"
        tone="primary"
        items={['Choose Klump at checkout', 'Complete approval securely', 'Split payment over time', 'Get your items immediately']}
      />
    );
  }
  return null;
}
