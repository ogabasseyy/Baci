'use client';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { OxygenPhoneHandoff } from './OxygenPhoneHandoff';
import { useOxygenSelfieStatus } from './use-oxygen-selfie-status';

const selfieOrigin = 'https://staging.d1l1k5yxed9cvn.amplifyapp.com';
export function isOxygenSelfieUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === selfieOrigin && !parsed.username && !parsed.password
    );
  } catch {
    return false;
  }
}
export function OxygenHostedSelfie({
  url,
  onClose,
  workflowId,
  onConfirmed = () => {
    /* Optional outside checkout. */
  },
}: {
  url: string;
  onClose(): void;
  workflowId?: string;
  onConfirmed?(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lastHint = useRef(0);
  const [phone, setPhone] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const status = useOxygenSelfieStatus(
    isOxygenSelfieUrl(url) ? workflowId : undefined,
    onConfirmed
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== selfieOrigin ||
        event.source !== frame.current?.contentWindow ||
        event.data !== 'FACE_RECOGNITION_SUCCESS' ||
        Date.now() - lastHint.current < 10_000
      )
        return;
      lastHint.current = Date.now();
      status.retry(); // Hint only; KYC must confirm DONE.
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [status.retry]);
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-white"
      aria-label="Selfie verification"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button
          type="button"
          aria-label="Back to application"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full hover:bg-gray-100"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="font-semibold">Verify it’s you</h2>
        {workflowId && !phone && (
          <button
            type="button"
            onClick={() => {
              setPhone(true);
              status.retry();
            }}
            className="ml-auto flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          >
            <Smartphone className="size-4" aria-hidden="true" />
            Try on your phone
          </button>
        )}
      </header>
      {phone && workflowId ? (
        <OxygenPhoneHandoff
          workflowId={workflowId}
          onPrepared={status.retry}
          onBack={() => setPhone(false)}
        />
      ) : isOxygenSelfieUrl(url) ? (
        <div className="relative min-h-0 flex-1 bg-white">
          {!loaded && (
            <p
              role="status"
              className="absolute inset-0 grid place-content-center bg-white text-sm text-gray-500"
            >
              Opening secure selfie check…
            </p>
          )}
          <iframe
            ref={frame}
            key={url}
            title="Oxygen selfie verification"
            src={url}
            allow="camera"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
        <p role="alert" className="p-6">
          This verification link cannot be opened here.
        </p>
      )}
      {status.paused && (
        <div role="status" className="p-3 text-sm text-gray-600">
          Oxygen hasn’t confirmed your selfie yet.{' '}
          <button type="button" className="underline" onClick={status.retry}>
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
