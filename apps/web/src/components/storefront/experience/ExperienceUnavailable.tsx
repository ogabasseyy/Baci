'use client';
import { useRouter } from 'next/navigation';
export function ExperienceUnavailable() {
  const router = useRouter();
  return (
    <main role="alert">
      <h1>Storefront temporarily unavailable</h1>
      <p>Refresh to load the current store.</p>
      <button type="button" onClick={() => router.refresh()}>
        Refresh storefront
      </button>
    </main>
  );
}
