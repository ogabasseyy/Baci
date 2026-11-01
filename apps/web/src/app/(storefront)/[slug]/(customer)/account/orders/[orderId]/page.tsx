import { Suspense } from 'react';
import CustomerOrderDetailsClient from './customer-order-details-client';
import { OrderDetailsRequestMarker } from './order-details-request-marker';

export default function CustomerOrderDetailsPage() {
  return (
    <>
      <CustomerOrderDetailsClient />
      <Suspense fallback={null}>
        <OrderDetailsRequestMarker />
      </Suspense>
    </>
  );
}
