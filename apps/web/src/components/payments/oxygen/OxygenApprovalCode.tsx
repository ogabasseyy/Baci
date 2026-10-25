'use client';
import { useRef, useState } from 'react';
import { useOtpSuccessTransition } from '@/components/ui/otp-verification/use-otp-success-transition';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenApprovalCode.module.css';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import { OxygenOtpField } from './OxygenOtpField';
import { OxygenSignature } from './OxygenSignature';
import { useOxygenApprovalWindow } from './use-oxygen-approval-window';
export function OxygenApprovalCode({
  workflowId,
  reference,
  state,
  requestCode,
  approvePlan,
  busy,
}: {
  workflowId: string;
  reference: string;
  state: OxygenProviderState;
  requestCode?: (reference: string) => Promise<boolean>;
  approvePlan?: (
    reference: string,
    otp: string,
    signature: File,
    onConfirmed?: () => Promise<void>
  ) => Promise<boolean>;
  busy: boolean;
}) {
  const [code, setCode] = useState('');
  const [signature, setSignature] = useState<File>();
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const { verified, showSuccess } = useOtpSuccessTransition();
  const [error, setError] = useState('');
  const lock = useRef(false);
  const attempted = useRef('');
  const timing = useOxygenApprovalWindow(workflowId, reference);
  const due = state.schedule?.[0]?.dueDate;
  const nextPaymentDate = due
    ? new Intl.DateTimeFormat('en-NG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(due[0], due[1] - 1, due[2])))
    : undefined;
  async function complete(otp: string) {
    const window = timing.window;
    if (
      !approvePlan ||
      !signature ||
      !accepted ||
      !nextPaymentDate ||
      busy ||
      pending ||
      verified ||
      lock.current ||
      !window ||
      timing.loading ||
      timing.error ||
      window.bookingReference !== reference ||
      reference !== state.bookingReference ||
      Date.now() >= Date.parse(window.expiresAt) ||
      !/^\d{6}$/.test(otp)
    )
      return;
    const attempt = `${window.sentAt}:${otp}`;
    if (attempted.current === attempt) return;
    attempted.current = attempt;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      let animated = false;
      const confirmed = async () => {
        animated = true;
        setPending(false);
        await showSuccess();
      };
      if (await approvePlan(reference, otp, signature, confirmed)) {
        if (!animated) await confirmed();
      } else
        setError(
          'Approval was not confirmed. Check your saved application status before trying again.'
        );
    } catch {
      setError(
        'Approval was not confirmed. Check your saved application status before trying again.'
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function resend() {
    if (
      !requestCode ||
      busy ||
      lock.current ||
      verified ||
      reference !== state.bookingReference
    )
      return false;
    const accepted = await requestCode(reference);
    if (!accepted) return false;
    setCode('');
    setError('');
    timing.reload();
    return true;
  }
  return (
    <section
      className={`grid gap-4 ${styles.flow}`}
      aria-label="Approval code verification"
    >
      <OxygenComparisonSummary
        heading="Verify your payment plan"
        state={state}
        loading={false}
        tenure={state.booking?.loan_tenure}
      />
      <section className={styles.confirmation} aria-label="Plan confirmation">
        <fieldset disabled={busy || pending || verified} className="grid gap-4">
          <OxygenSignature
            embedded
            initialSignature={signature}
            disabled={busy || pending || verified}
            onChange={(file) => {
              setSignature(file);
              setCode('');
              setError('');
            }}
          />
        </fieldset>
        <div className={styles.codeEntry}>
          <OxygenOtpField
            value={code}
            onChange={setCode}
            onComplete={(otp) => void complete(otp)}
            disabled={busy || timing.loading}
            pending={pending}
            readOnly={
              !timing.window ||
              !signature ||
              !accepted ||
              !nextPaymentDate ||
              !approvePlan ||
              Boolean(error)
            }
            verified={verified}
            error={error}
            sentAt={
              timing.window ? Date.parse(timing.window.sentAt) : undefined
            }
            onResend={requestCode ? resend : undefined}
            hint={
              timing.loading
                ? 'Checking your saved code status…'
                : !timing.window
                  ? 'Request a new code to continue.'
                  : !signature || !accepted
                    ? 'Add your signature and accept the offer before entering your code.'
                    : 'Enter your email code. The final digit approves this plan.'
            }
          />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-red-600"
            disabled={busy || pending || verified || !nextPaymentDate}
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.currentTarget.checked);
              setCode('');
            }}
          />
          <span className="text-red-700">
            {nextPaymentDate ? (
              <>
                I accept this payment plan and understand my next payment is due
                on <strong>{nextPaymentDate}</strong>.
              </>
            ) : (
              'Your next payment date will appear when Oxygen confirms your schedule.'
            )}
          </span>
        </label>
      </section>
      {timing.error && (
        <div role="alert" className="text-sm text-gray-600">
          <p>{timing.error}</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => void timing.reload()}
            disabled={busy || timing.loading}
          >
            Check code status
          </button>
        </div>
      )}
    </section>
  );
}
