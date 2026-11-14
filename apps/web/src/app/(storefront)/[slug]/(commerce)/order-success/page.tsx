import { Suspense } from 'react';
import { OrderSuccessContent } from './order-success-content';
import { OrderSuccessRequestMarker } from './order-success-request-marker';

export default function OrderSuccessPage() {
  return (
    <>
      <Suspense fallback={null}>
        <OrderSuccessContent />
      </Suspense>
      <Suspense fallback={null}>
        <OrderSuccessRequestMarker />
      </Suspense>
    </>
  );
}
