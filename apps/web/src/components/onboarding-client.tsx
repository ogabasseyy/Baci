'use client';

import dynamic from 'next/dynamic';
import { Logo } from '@/components/logo';

const WebOnboardingChat = dynamic(
  () =>
    import('@/components/onboarding/chat/WebOnboardingChat').then(
      (mod) => mod.default
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-pulse">
          <Logo width={80} height={25} priority />
        </div>
      </div>
    ),
  }
);

export default function OnboardingClient() {
  return <WebOnboardingChat />;
}
