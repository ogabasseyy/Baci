'use client';
import { ArrowLeft, Camera, Check, RefreshCw, Smartphone } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';

const schema = z.object({
  qr: z.string().startsWith('data:image/png;base64,'),
  expiresAt: z.number(),
});
export function OxygenPhoneHandoff({
  workflowId,
  onBack,
  onPrepared,
}: {
  workflowId: string;
  onBack(): void;
  onPrepared?(): void;
}) {
  const [handoff, setHandoff] = useState<z.infer<typeof schema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!handoff) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [handoff]);
  const prepareRequest = useRef<() => Promise<void>>(async () => {
    /* Assigned below before effects run. */
  });
  useEffect(() => {
    void workflowId;
    void prepareRequest.current();
  }, [workflowId]);
  async function prepare() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setHandoff(null);
    try {
      const response = await fetchWithCsrf(
        '/api/payments/oxygen/workflows/phone-handoff',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (!response.ok) throw new Error('Unavailable');
      const result = schema.parse(await response.json());
      if (alive.current) {
        setNow(Date.now());
        setHandoff(result);
        onPrepared?.();
      }
    } catch {
      if (alive.current)
        setError(
          'We couldn’t prepare phone verification. Your application is saved. Try again.'
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  prepareRequest.current = prepare;
  const seconds = handoff
    ? Math.max(0, Math.ceil((handoff.expiresAt - now) / 1000))
    : 0;
  const expired = Boolean(handoff && seconds === 0);
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-red-50/60 via-white to-white px-6 py-8 sm:py-10">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white text-red-600 shadow-sm ring-1 ring-red-100">
          <Smartphone className="size-6" aria-hidden="true" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-widest text-red-600">
          Continue on your phone
        </p>
        <h3 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
          Scan. Verify. You’re back.
        </h3>
        <p className="mt-3 max-w-xs text-sm leading-6 text-gray-500">
          Open your phone’s camera and scan the QR. Oxygen will guide you
          through the selfie.
        </p>
        <div className="mt-6 w-full rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex min-h-60 items-center justify-center rounded-2xl border border-gray-100 bg-white p-3">
            {handoff && !expired ? (
              <Image
                src={handoff.qr}
                alt="Scan to continue Oxygen selfie verification on your phone"
                width={224}
                height={224}
                unoptimized
                className="h-auto w-full max-w-56"
              />
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center gap-4">
                <Camera className="size-9 text-red-500" aria-hidden="true" />
                <p className="max-w-48 text-sm text-gray-500">
                  {expired
                    ? 'This QR has expired. Get a fresh one to continue.'
                    : error
                      ? 'We couldn’t prepare your QR.'
                      : 'Preparing your secure QR…'}
                </p>
                {(expired || error) && (
                  <button
                    type="button"
                    onClick={() => void prepare()}
                    disabled={busy}
                    className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy
                      ? 'Preparing QR…'
                      : expired
                        ? 'Get a fresh QR'
                        : 'Try again'}
                  </button>
                )}
              </div>
            )}
          </div>
          {handoff && !expired && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Valid for {remaining}
              </span>
              <button
                type="button"
                onClick={() => void prepare()}
                disabled={busy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-medium text-gray-600 hover:bg-gray-50"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Refresh QR
              </button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-start gap-2 rounded-2xl bg-gray-50 p-4 text-left text-xs leading-5 text-gray-600">
          <Check
            className="mt-0.5 size-4 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <p>
            Keep this window open. We’ll continue here when Oxygen confirms your
            selfie.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Use this laptop instead
        </button>
      </div>
    </div>
  );
}
