import { connection } from 'next/server';
import { Suspense } from 'react';
import CustomerLoginPage from './customer-login-page';

// Storefront metadata uses the request's dynamic merchant identifier. Keep
// that work out of the visible form's prerendered shell.
async function LoginMetadataRequestMarker() {
  await connection();
  return null;
}

export default function LoginPage() {
  return (
    <>
      <CustomerLoginPage />
      <Suspense fallback={null}>
        <LoginMetadataRequestMarker />
      </Suspense>
    </>
  );
}
