'use client';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { OxygenPhoneHandoff } from './OxygenPhoneHandoff';
import { OxygenSelfieLoading } from './OxygenSelfieLoading';
import { OxygenSelfieSessionRecovery } from './OxygenSelfieSessionRecovery';
import { useOxygenHostedSelfieRenewal } from './use-oxygen-hosted-selfie-renewal';
import { useOxygenSelfieStatus } from './use-oxygen-selfie-status';

export function isOxygenSelfieUrl(
  url: string,
  origins: readonly string[] = []
): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      !parsed.port &&
      origins.includes(parsed.origin) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
export function OxygenHostedSelfie({
  url,
  selfieOrigins = [],
  onClose,
  workflowId,
  onRenew,
  onConfirmed = () => {
    /* Optional outside checkout. */
  },
}: {
  url: string;
  selfieOrigins?: readonly string[];
  onClose(): void;
  workflowId?: string;
  onConfirmed?(): void;
  onRenew?(
    automatic: boolean,
    signal: AbortSignal
  ): Promise<'confirmed' | 'renewed'>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lastHint = useRef(0);
  const [phone, setPhone] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    void url; // A different link starts a new capture/loading session.
    setLoaded(false);
    setConfirming(false);
  }, [url]);
  const trustedOrigin = isOxygenSelfieUrl(url, selfieOrigins)
    ? new URL(url).origin
    : null;
  const renewal = useOxygenHostedSelfieRenewal(
    url,
    Boolean(trustedOrigin) && !phone,
    onRenew,
    onConfirmed
  );
  const status = useOxygenSelfieStatus(
    trustedOrigin && !renewal.renewing ? workflowId : undefined,
    onConfirmed
  );
  const retryFromHint = useEffectEvent(() => status.retry());
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        !trustedOrigin ||
        !workflowId ||
        event.origin !== trustedOrigin ||
        event.source !== frame.current?.contentWindow ||
        event.data !== 'FACE_RECOGNITION_SUCCESS' ||
        Date.now() - lastHint.current < 10_000
      )
        return;
      lastHint.current = Date.now();
      setConfirming(true);
      retryFromHint(); // Hint only; KYC must confirm DONE.
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trustedOrigin, workflowId]);
  const showConfirming = confirming && !status.paused;
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-white"
      aria-label="Selfie verification"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2">
        <button
          type="button"
          aria-label="Back to application"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full hover:bg-gray-100"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="font-semibold">Verify it’s you</h2>
      </header>
      {phone && workflowId ? (
        <OxygenPhoneHandoff
          workflowId={workflowId}
          onPrepared={status.retry}
          onBack={() => setPhone(false)}
        />
      ) : trustedOrigin && (renewal.expired || renewal.renewing) ? (
        <OxygenSelfieSessionRecovery
          renewing={renewal.renewing}
          error={renewal.error}
          onRetry={onRenew ? renewal.retry : undefined}
        />
      ) : trustedOrigin ? (
        <div className="relative min-h-0 flex-1 bg-white">
          {(!loaded || showConfirming) && (
            <OxygenSelfieLoading confirming={showConfirming} />
          )}
          <iframe
            ref={frame}
            key={url}
            title="Oxygen selfie verification"
            src={url}
            allow="camera"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full border-0 bg-white ${!loaded || showConfirming ? 'invisible' : ''}`}
          />
        </div>
      ) : (
        <p role="alert" className="p-6">
          This verification link cannot be opened here.
        </p>
      )}
      {workflowId && !phone && (
        <footer className="shrink-0 border-t border-gray-100 bg-white p-3">
          <button
            type="button"
            onClick={() => {
              setPhone(true);
              setConfirming(false);
              status.retry();
            }}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-store-primary px-4 py-3 text-sm font-semibold text-store-primary-text"
          >
            <Smartphone className="size-5" aria-hidden="true" />
            Continue on your phone
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            Scan a QR code to use your phone’s camera.
          </p>
        </footer>
      )}
      {status.paused && (
        <div role="status" className="p-3 text-sm text-gray-600">
          Oxygen hasn’t confirmed your selfie yet.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setConfirming(false);
              status.retry();
            }}
          >
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
