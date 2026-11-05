'use client';
import { useState } from 'react';
import {
  ExperienceFrame,
  type ExperienceFrameLaunch,
} from '@/components/storefront/experience/ExperienceFrame';
import { apiPost } from '@/lib/api-client';

type Launch = ExperienceFrameLaunch & { bindingId: string; merchantId: string };
export function PreviewClient({
  merchantId,
  buildId,
  routeId,
}: {
  merchantId: string;
  buildId: string;
  routeId?: string;
}) {
  const [session, setSession] = useState<{
    launch: Launch;
    isActive: () => Promise<boolean>;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function launch() {
    setBusy(true);
    setError('');
    try {
      const launch = await apiPost<Launch>('/api/builder-experience/preview', {
        merchantId,
        buildId,
        ...(routeId ? { routeId } : {}),
      });

      setSession({
        launch,
        isActive: async () => {
          try {
            const r = await fetch(
              `/api/builder-experience/preview?bindingId=${encodeURIComponent(launch.bindingId)}&merchantId=${encodeURIComponent(merchantId)}`,
              { cache: 'no-store' }
            );
            if (!r.ok) return false;
            const body: unknown = await r.json();
            return (
              typeof body === 'object' &&
              body !== null &&
              'active' in body &&
              body.active === true
            );
          } catch {
            return false;
          }
        },
      });
    } catch {
      setError('Preview unavailable. Sign in or request a fresh build.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Private full-code preview</h1>
      <p>
        Commerce is simulated. This preview cannot create orders or payments.
      </p>
      <button type="button" disabled={busy} onClick={launch}>
        {busy ? 'Opening preview…' : 'Open private preview'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {session ? (
        <ExperienceFrame launch={session.launch} isActive={session.isActive} />
      ) : null}
    </main>
  );
}
