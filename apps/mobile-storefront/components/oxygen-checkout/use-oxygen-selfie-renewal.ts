import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';
import { oxygenSelfieExpiresAt } from './oxygen-selfie-expiry';

type Options = {
  url?: string;
  enabled: boolean;
  blocked: boolean;
  workflowId: string;
  client: OxygenClient;
  controller: OxygenWorkflowController;
};
/** One automatic renewal per mounted checkout; at most two explicit retries. */
export function useOxygenSelfieRenewal(options: Options) {
  const current = useRef(options);
  current.current = options;
  const [now, setNow] = useState(Date.now);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active'
  );
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState('');
  const attempts = useRef(0);
  const automatic = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const expiresAt = oxygenSelfieExpiresAt(options.url);
  const expired = expiresAt !== null && expiresAt <= Math.max(now, Date.now());
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      alive.current = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (!options.enabled || !foreground || expiresAt === null) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      if (now < expiresAt) setNow(Date.now());
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(delay, 2147483647)
    );
    return () => clearTimeout(timer);
  }, [options.enabled, foreground, expiresAt, now]);

  async function renew() {
    const p = current.current;
    if (
      !p.enabled ||
      p.blocked ||
      AppState.currentState !== 'active' ||
      inFlight.current
    )
      return;
    if (attempts.current >= 3) {
      setError(
        'We could not renew verification. Return to saved progress and try again later.'
      );
      return;
    }
    inFlight.current = true;
    attempts.current++;
    setRenewing(true);
    setError('');
    recordOxygenSelfieDiagnostic('renewal_started');
    try {
      const result = await p.client.selfieStatus(p.workflowId);
      if (
        !alive.current ||
        !current.current.enabled ||
        current.current.workflowId !== p.workflowId ||
        AppState.currentState !== 'active'
      )
        return;
      if (result.confirmed) {
        await p.controller.execute({ action: 'refresh_kyc' });
        if (p.controller.getState().error)
          throw new Error('Status unavailable');
      } else {
        await p.controller.execute({ action: 'selfie_link' });
        const state = p.controller.getState();
        const fresh = state.snapshot?.state.selfieUrl;
        const expiry = oxygenSelfieExpiresAt(fresh);
        if (
          state.error ||
          !fresh ||
          fresh === p.url ||
          (expiry !== null && expiry <= Date.now())
        )
          throw new Error('Renewal unavailable');
        recordOxygenSelfieDiagnostic('renewal_succeeded');
      }
    } catch {
      recordOxygenSelfieDiagnostic('renewal_failed');
      if (alive.current)
        setError(
          'We could not renew your verification session. Please try again.'
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setRenewing(false);
    }
  }
  const renewRef = useRef(renew);
  renewRef.current = renew;
  useEffect(() => {
    if (
      expired &&
      options.enabled &&
      !options.blocked &&
      foreground &&
      !automatic.current
    ) {
      automatic.current = true;
      recordOxygenSelfieDiagnostic('session_expired');
      void renewRef.current();
    }
  }, [expired, options.enabled, options.blocked, foreground]);
  return { expired, renewing, error, renew };
}
