import { z } from 'zod';
import type {
  OxygenProviderContext,
  OxygenProviderState,
  OxygenRuntimeAction,
} from '@/schemas/oxygen-runtime';
import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';
export function requireValue<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Required workflow data unavailable');
  return value;
}
export function hosted(value: unknown, hosts: ReadonlySet<string>): string {
  const url = new URL(z.string().parse(value));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname)
  )
    throw new Error('Untrusted hosted link');
  return url.href;
}
export function preBookingKyc(s: OxygenProviderState): boolean {
  return Boolean(
    s.validated &&
      s.kyc &&
      (
        [
          'bvn_status',
          'nin_status',
          'bank_status',
          'phone_status',
          'selfie_status',
        ] as const
      ).every((key) => s.kyc?.[key] === 'DONE')
  );
}
export function stageFor(s: OxygenProviderState): OxygenWorkflowStage {
  if (!s.applicationReference) return 'application_required';
  if (s.booking?.status === 'APPROVED')
    return s.paymentComplete && s.setupComplete
      ? 'ready_for_activation'
      : 'payment_required';
  if (s.bookingReference)
    return s.kyc?.address_status === 'DONE' ? 'approval_required' : 'booked';
  if (!s.validated) return 'eligibility_required';
  if (!s.eligible) return 'eligibility_required';
  return preBookingKyc(s) ? 'plan_required' : 'kyc_required';
}
export function oxygenActionAllowed(
  c: Pick<
    OxygenProviderContext,
    'stage' | 'environment' | 'state' | 'bookingBlock'
  >,
  a: OxygenRuntimeAction
): boolean {
  const stage = c.stage;
  if (
    c.environment !== 'staging' ||
    ['activated', 'reconciliation_required'].includes(stage)
  )
    return false;
  switch (a.action) {
    case 'start_application':
      return !c.state.applicationReference && stage === 'application_required';
    case 'resend_customer_otp':
    case 'validate_customer':
      return Boolean(c.state.applicationReference && !c.state.validated);
    case 'validate_nin':
      return Boolean(
        c.state.applicationReference &&
          c.state.validated &&
          !c.state.bookingReference &&
          c.state.kyc?.selfie_status === 'DONE'
      );
    case 'refresh_eligibility':
    case 'selfie_link':
      return Boolean(
        c.state.applicationReference &&
          c.state.validated &&
          !c.state.bookingReference
      );
    case 'refresh_kyc':
      return Boolean(c.state.applicationReference);
    case 'book':
      return (
        !c.bookingBlock &&
        (stage === 'plan_required' ||
          (['booked', 'approval_required'].includes(stage) &&
            c.state.booking?.status === 'BOOKED' &&
            !c.state.activityToken &&
            !c.state.paymentComplete)) &&
        (!c.state.bookingReference ||
          c.state.booking?.equity_percentage !== a.equityPercentage ||
          c.state.booking?.loan_tenure !== a.tenure) &&
        preBookingKyc(c.state) &&
        c.state.eligible === true
      );
    case 'submit_address':
      return Boolean(
        c.state.bookingReference &&
          ['booked', 'approval_required'].includes(stage)
      );
    case 'trigger_approval_otp':
    case 'approve_booking':
      return (
        stage === 'approval_required' && c.state.kyc?.address_status === 'DONE'
      );
    case 'cancel_booking':
      return Boolean(
        c.state.bookingReference &&
          ['booked', 'approval_required'].includes(stage)
      );
    case 'refresh_details':
      return Boolean(c.state.bookingReference);
    case 'refresh_payment_setup':
      return ['payment_required', 'ready_for_activation'].includes(stage);
  }
}
