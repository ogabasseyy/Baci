import { notFound } from 'next/navigation';
import { OxygenPaymentSuccessPreview } from '@/components/payments/oxygen/OxygenPaymentSuccessPreview';

export default function OxygenPaymentSuccessPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <OxygenPaymentSuccessPreview />;
}
