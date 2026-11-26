'use client';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { PreviewClient } from '../preview/preview-client';
import { prepareApprovalUntilReady } from './prepare-approval';
import { ExperienceVerificationRetry } from './verification-retry';
export interface ExperienceApprovalView {
  approvalId: string;
  merchantId: string;
  kind: 'draft' | 'lifecycle';
  action: string;
  buildId?: string;
  effectDigest: string;
  routes?: unknown;
  capabilities?: unknown;
  summary?: unknown;
  enabled: boolean;
  needsPreparation?: boolean;
}

type ApprovalPostAction =
  | 'confirm-draft'
  | 'confirm-publication'
  | 'confirm-mode-exit';
interface ConfirmationPresentation {
  requestAction: ApprovalPostAction;
  description: string;
  buttonLabel: string;
}
const confirmationByAction: Readonly<
  Record<string, ConfirmationPresentation | undefined>
> = {
  'draft:apply': {
    requestAction: 'confirm-draft',
    description:
      'Apply this build to the private draft. Public content stays unchanged.',
    buttonLabel: 'Confirm private apply',
  },
  'lifecycle:publish': {
    requestAction: 'confirm-publication',
    description: 'Make this reviewed experience publicly available.',
    buttonLabel: 'Confirm publication',
  },
  'lifecycle:rollback': {
    requestAction: 'confirm-publication',
    description:
      'Replace the public experience with a retained compatible build.',
    buttonLabel: 'Confirm rollback',
  },
  'lifecycle:draft-only': {
    requestAction: 'confirm-mode-exit',
    description:
      'Exit full-code mode with the exact legacy effect shown below. Legacy AI stays paused.',
    buttonLabel: 'Confirm mode exit',
  },
  'lifecycle:restore-legacy': {
    requestAction: 'confirm-mode-exit',
    description:
      'Exit full-code mode with the exact legacy effect shown below. Legacy AI stays paused.',
    buttonLabel: 'Confirm mode exit',
  },
  'lifecycle:unpublish-legacy-draft': {
    requestAction: 'confirm-mode-exit',
    description:
      'Exit full-code mode with the exact legacy effect shown below. Legacy AI stays paused.',
    buttonLabel: 'Confirm mode exit',
  },
};

export function ExperienceApprovalClient({
  view,
}: {
  view: ExperienceApprovalView;
}) {
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [approvalId, setApprovalId] = useState(view.approvalId);
  const [preparedUntil, setPreparedUntil] = useState(0);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
  useEffect(() => {
    if (preparedUntil === 0) return;
    const timer = setTimeout(
      () => setPreparedUntil(0),
      Math.max(0, preparedUntil - Date.now())
    );
    return () => clearTimeout(timer);
  }, [preparedUntil]);
  const confirmation = confirmationByAction[`${view.kind}:${view.action}`];
  const needsPreparation = view.needsPreparation && preparedUntil === 0;
  async function prepare() {
    if (!view.enabled || !confirmation || busy || !needsPreparation) return;
    setBusy(true);
    setResult('Preparing route evidence…');
    const controller = new AbortController();
    preparation.current = controller;
    try {
      const ready = await prepareApprovalUntilReady({
        approvalId,
        action: view.kind === 'draft' ? 'prepare-draft' : 'prepare-publication',
        signal: controller.signal,
        onProgress: (nextId) => {
          setApprovalId(nextId);
          const url = new URL(window.location.href);
          if (url.searchParams.get('approval') !== nextId) {
            url.searchParams.set('approval', nextId);
            window.history.replaceState(window.history.state, '', url);
          }
        },
      });
      if (ready.status === 'reconciled') {
        setResult(
          'This approval already has a receipt. Reload the review to see the result.'
        );
        return;
      }
      const deadline = ready.expiresAt ? Date.parse(ready.expiresAt) : 0;
      if (deadline <= Date.now()) throw Error('Approval window elapsed');
      setPreparedUntil(deadline);
      setResult('');
    } catch {
      if (!controller.signal.aborted)
        setResult(
          'Preparation paused. Try again to resume saved route evidence.'
        );
    } finally {
      preparation.current = null;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!view.enabled || !confirmation || busy) return;
    if (view.needsPreparation && preparedUntil <= Date.now()) return;
    setBusy(true);
    setResult('');
    try {
      const response = await apiPost<{ status?: string; version?: number }>(
        '/api/builder-experience/approval',
        {
          action: confirmation.requestAction,
          approvalId,
        }
      );
      setResult(
        response.status ??
          (response.version === undefined
            ? 'Confirmation received. Reload to verify the current state.'
            : `Private draft version ${response.version}`)
      );
    } catch {
      setResult(
        'Confirmation unavailable. Read the current approval before retrying.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Review exact experience change</h1>
      <p>
        {confirmation?.description ??
          'This approval action is not recognized. Read the current approval before retrying.'}
      </p>
      <p>
        Effect: <code>{view.effectDigest}</code>
      </p>
      <h2>Routes and capabilities</h2>
      <pre>
        {JSON.stringify(
          { routes: view.routes, capabilities: view.capabilities },
          null,
          2
        )}
      </pre>
      <details>
        <summary>Exact change</summary>
        <pre>{JSON.stringify(view.summary, null, 2)}</pre>
      </details>
      {view.buildId ? (
        <section
          aria-label="Clipped interactive preview"
          style={{
            height: 440,
            overflow: 'auto',
            contain: 'strict',
            border: '1px solid currentColor',
          }}
        >
          <PreviewClient merchantId={view.merchantId} buildId={view.buildId} />
        </section>
      ) : null}
      <section aria-label="Owner confirmation">
        <p>
          Preview interactions use simulated commerce. This change does not
          create orders or payments.
        </p>
        {!view.enabled ? <p>Confirmation runtime is unavailable.</p> : null}
        {view.enabled && !confirmation ? (
          <p>This approval action is not recognized.</p>
        ) : null}
        <button
          type="button"
          disabled={
            !view.enabled ||
            !confirmation ||
            busy ||
            (!needsPreparation && !!result)
          }
          onClick={needsPreparation ? prepare : confirm}
        >
          {busy
            ? needsPreparation
              ? 'Preparing…'
              : 'Confirming…'
            : needsPreparation
              ? 'Prepare approval'
              : (confirmation?.buttonLabel ?? 'Confirmation unavailable')}
        </button>
        {result === 'verifying' &&
        confirmation?.requestAction === 'confirm-publication' ? (
          <ExperienceVerificationRetry approvalId={approvalId} />
        ) : result ? (
          <p role="status">{result}</p>
        ) : null}
      </section>
    </main>
  );
}
