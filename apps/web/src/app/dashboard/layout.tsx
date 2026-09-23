import { type ReactNode, Suspense } from 'react';
import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import { PasskeyEnrollmentPrompt } from '@/components/passkey-enrollment-prompt';
import { DashboardAuthGuard } from './auth-guard';
import DashboardLoading from './loading';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AppSansFont>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardAuthGuard>
          <PasskeyEnrollmentPrompt />
          {children}
        </DashboardAuthGuard>
      </Suspense>
    </AppSansFont>
  );
}
