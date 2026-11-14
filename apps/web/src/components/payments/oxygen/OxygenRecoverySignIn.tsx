'use client';
import { OxygenSignIn } from './OxygenSignIn';

/** Sign in before accessing the owned-order recovery surface. */
export function OxygenRecoverySignIn({
  merchantSlug,
}: {
  merchantSlug: string;
}) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <OxygenSignIn
        merchantSlug={merchantSlug}
        onSignedIn={() => window.location.reload()}
      />
    </main>
  );
}
