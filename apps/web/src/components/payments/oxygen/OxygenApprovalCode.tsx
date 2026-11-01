'use client';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOtpSuccessTransition } from '@/components/ui/otp-verification/use-otp-success-transition';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenApprovalCode.module.css';
import { OxygenApprovalCodeHeading } from './OxygenApprovalCodeHeading';
import { OxygenApprovalSignatureStep } from './OxygenApprovalSignatureStep';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import { OxygenOtpField } from './OxygenOtpField';
import { useOxygenApprovalSignature } from './use-oxygen-approval-signature';
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
  const signing = useOxygenApprovalSignature();
  const { signature, accepted, saving } = signing;
  const [codeStep, setCodeStep] = useState(false);
  const codeHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (codeStep) {
      codeHeading.current?.focus({ preventScroll: true });
      codeHeading.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [codeStep]);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  async function complete(otp: string, file: File) {
    const window = timing.window;
    if (
      !approvePlan ||
      !accepted ||
      !signature ||
      !codeStep ||
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
      if (await approvePlan(reference, otp, file, confirmed)) {
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
  async function continueToCode() {
    if (
      !accepted ||
      !signature ||
      !nextPaymentDate ||
      !requestCode ||
      busy ||
      lock.current ||
      reference !== state.bookingReference
    )
      return;
    lock.current = true;
    setError('');
    try {
      const file = signature;
      if (!mounted.current) return;
      if (!file) {
        setError('Add your signature before continuing.');
        return;
      }
      setSending(true);
      const sent = await requestCode(reference);
      if (!mounted.current) return;
      if (!sent) {
        setError(
          'We could not confirm that your code was sent. Your signature is saved. Check your application status before trying again.'
        );
        return;
      }
      setCode('');
      timing.reload();
      setCodeStep(true);
    } catch {
      if (mounted.current)
        setError(
          'We could not confirm that your code was sent. Your signature is saved. Check your application status before trying again.'
        );
    } finally {
      lock.current = false;
      if (mounted.current) {
        setSending(false);
      }
    }
  }
  return (
    <section
      className={`grid gap-4 ${codeStep ? styles.flow : ''}`}
      aria-label="Approval code verification"
      data-oxygen-approval-step={codeStep ? 'code' : 'signature'}
    >
      {!codeStep ? (
        <>
          <OxygenComparisonSummary
            compact
            heading="Sign and accept your payment plan"
            state={state}
            loading={false}
            tenure={state.booking?.loan_tenure}
          />
          <OxygenApprovalSignatureStep
            signature={signature}
            capture={signing.capture}
            nextPaymentDate={nextPaymentDate}
            accepted={accepted}
            disabled={
              busy ||
              saving ||
              sending ||
              !requestCode ||
              reference !== state.bookingReference
            }
            saving={saving}
            sending={sending}
            error={signing.error || error}
            onSignature={(file) => {
              signing.change(file);
              setError('');
            }}
            onAccept={(value) => {
              setError('');
              void signing.accept(value);
            }}
            onContinue={() => void continueToCode()}
          />
        </>
      ) : (
        <section
          className={`${styles.confirmation} ${styles.codeCard}`}
          aria-label="Approval code"
        >
          <OxygenApprovalCodeHeading headingRef={codeHeading} />
          <div className={styles.codeEntry}>
            <OxygenOtpField
              value={code}
              onChange={(value) => {
                setCode(value);
              }}
              onComplete={(otp) => {
                if (signature) void complete(otp, signature);
              }}
              disabled={busy || saving || timing.loading}
              pending={pending}
              hidePendingMessage
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
                    : ''
              }
            />
          </div>
          <button
            type="button"
            className={styles.backButton}
            disabled={busy || pending || verified || Boolean(error)}
            onClick={() => {
              setCode('');
              setCodeStep(false);
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to signature
          </button>
        </section>
      )}
      {codeStep && timing.error && (
        <div role="alert" className="text-sm text-gray-600">
          <p>{timing.error}</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => void timing.reload()}
            disabled={busy || saving || timing.loading}
          >
            Check code status
          </button>
        </div>
      )}
    </section>
  );
}
