import type { Metadata } from 'next';
import { Suspense } from 'react';
import LoginLoadingFallback from '@/app/(auth)/login/login-loading-fallback';
import {
  LoginPageContent,
  type LoginPageProps,
} from '@/app/(auth)/login/login-page-content';

export const metadata: Metadata = {
  title: 'Login - Access Your Dashboard',
  description:
    'Log in to your Baci dashboard to manage your store, products, and orders. Secure access for business owners.',
  robots: { index: false, follow: false },
};

export default function LoginPage(props: LoginPageProps) {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <LoginPageContent {...props} />
    </Suspense>
  );
}
