'use client';
import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { PreviewClient } from '../preview/preview-client';
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
  const confirmation = confirmationByAction[`${view.kind}:${view.action}`];
  async function confirm() {
    if (!view.enabled || !confirmation || busy) return;
    setBusy(true);
    setResult('');
    try {
      const response = await apiPost<{ status?: string; version?: number }>(
        '/api/builder-experience/approval',
        {
          action: confirmation.requestAction,
          approvalId: view.approvalId,
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
          disabled={!view.enabled || !confirmation || busy || !!result}
          onClick={confirm}
        >
          {busy
            ? 'Confirming…'
            : (confirmation?.buttonLabel ?? 'Confirmation unavailable')}
        </button>
        {result === 'verifying' &&
        confirmation?.requestAction === 'confirm-publication' ? (
          <ExperienceVerificationRetry approvalId={view.approvalId} />
        ) : result ? (
          <p role="status">{result}</p>
        ) : null}
      </section>
    </main>
  );
}
