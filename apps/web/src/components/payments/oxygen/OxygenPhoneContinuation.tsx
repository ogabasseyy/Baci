'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';

/** The fragment never reaches HTTP access logs. Exchange once; never log or persist it. */
export function OxygenPhoneContinuation() {
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    async function open() {
      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Unavailable');
        const response = await fetchWithCsrf(
          '/api/payments/oxygen/phone-handoff/redeem',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            cache: 'no-store',
          }
        );
        if (!response.ok) throw new Error('Unavailable');
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== 'object' ||
          !('url' in body) ||
          typeof body.url !== 'string'
        )
          throw new Error('Unavailable');
        const url = new URL(body.url);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port
        )
          throw new Error('Unavailable');
        // Server enforces the exact provider host; no arbitrary client-selected destination.
        window.location.replace(url.href);
      } catch {
        setFailed(true);
      }
    }
    void open();
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <div className="max-w-sm space-y-3 text-center" role="status">
        <h1 className="text-xl font-semibold">
          {failed ? 'Scan a new QR code' : 'Opening your selfie camera…'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {failed
            ? 'This link has expired or was already used. Return to your other device and generate a new QR code.'
            : 'You’ll continue securely with Oxygen. Keep your application open on your other device.'}
        </p>
      </div>
    </main>
  );
}
