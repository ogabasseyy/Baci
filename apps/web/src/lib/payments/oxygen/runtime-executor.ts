import { oxygenOtpResendResponseSchema } from '@/schemas/oxygen-otp-response';
import 'server-only';
import { z } from 'zod';
import { oxygenEligibilityReportSchema } from '@/schemas/oxygen-eligibility-report';
import {
  type OxygenProviderContext,
  type OxygenProviderState,
  type OxygenRuntimeAction,
  type OxygenTransientFile,
  oxygenBookingSchema,
  oxygenKycSchema,
  validateOxygenFile,
} from '@/schemas/oxygen-runtime';
import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';
import { toOxygenMinorUnits } from './money';
import type { OxygenProvider } from './provider';
import { bookOxygenPlan } from './runtime-booking';
import { parseOxygenBreakdown } from './runtime-details';

import { hosted, requireValue, stageFor } from './runtime-policy';

export { oxygenActionAllowed } from './runtime-policy';

import { oxygenActionAllowed } from './runtime-policy';
/** Each invocation performs only an explicitly allowlisted staging operation.
 * Inputs containing OTPs/documents/signatures are transient, never returned. */
export async function executeOxygenAction(
  c: OxygenProviderContext,
  a: OxygenRuntimeAction,
  p: OxygenProvider,
  hosts: ReadonlySet<string>,
  file?: OxygenTransientFile
): Promise<{ stage: OxygenWorkflowStage; state: OxygenProviderState }> {
  if (!oxygenActionAllowed(c, a))
    throw new Error('Action unavailable at this stage');
  if (
    c.state.booking &&
    [
      'trigger_approval_otp',
      'approve_booking',
      'refresh_payment_setup',
    ].includes(a.action) &&
    toOxygenMinorUnits(c.productAmount, 'NGN') !==
      toOxygenMinorUnits(c.state.booking.product_amount, 'NGN')
  )
    throw new Error('Checkout amount changed');
  const s: OxygenProviderState = structuredClone(c.state);
  const refs = () => ({
    loan_request_reference: requireValue(s.applicationReference),
    partner_reference: c.partnerReference,
  });
  const loan = () => ({ loan_reference: requireValue(s.bookingReference) });
  switch (a.action) {
    case 'start_application': {
      const phone = a.customer.customer_personal_details.phone_number;
      const orderPhone = c.orderPhone.replace(/\D/g, '').replace(/^0/, '234');
      if (phone !== orderPhone)
        throw new Error('Customer phone must match checkout');
      const response = z
        .object({
          loan_request_reference: z.uuid(),
          partner_reference: z.string(),
          message: z.enum([
            'OTP sent for validation',
            'Customer creation initiated',
          ]),
          token: z.string().optional(),
        })
        .parse(
          await p.call('create', {
            ...a.customer,
            partner_reference: c.partnerReference,
          })
        );
      if (response.partner_reference !== c.partnerReference)
        throw new Error('Provider binding mismatch');
      s.applicationReference = response.loan_request_reference;
      s.phone = phone;
      s.customerPath =
        response.message === 'OTP sent for validation' ? 'existing' : 'new';
      if (response.token) s.newUserToken = response.token;
      break;
    }
    case 'resend_customer_otp': {
      const path = requireValue(s.customerPath);
      oxygenOtpResendResponseSchema.parse(
        await p.call(path === 'new' ? 'resend_new' : 'resend_existing', refs())
      );
      break;
    }
    case 'validate_customer': {
      const payload: Record<string, unknown> = {
        ...refs(),
        phone_number: requireValue(s.phone),
        otp: a.otp,
      };
      const path = requireValue(s.customerPath);
      if (path === 'new') payload.token = requireValue(s.newUserToken);
      const response = z
        .object({
          message: z.enum([
            'OTP validation successful',
            'Account validation successful',
          ]),
        })
        .parse(
          await p.call(
            path === 'new' ? 'validate_new' : 'validate_existing',
            payload
          )
        );
      if (!response.message) throw new Error('Validation unconfirmed');
      s.validated = true;
      delete s.newUserToken;
      break;
    }
    case 'refresh_eligibility': {
      const response = oxygenEligibilityReportSchema.parse(
        await p.call('eligibility', refs())
      );
      if (
        response.loan_request_reference !== s.applicationReference ||
        response.partner_reference !== c.partnerReference
      )
        throw new Error('Provider binding mismatch');
      s.eligibilityStatus =
        response.status === 'COMPLETED'
          ? 'completed'
          : response.status === 'FAILED'
            ? 'failed'
            : 'pending';
      if (response.status === 'COMPLETED') s.eligible = response.is_eligible;
      else delete s.eligible;
      if (s.eligible) {
        s.eligibleAmount = Math.min(
          requireValue(response.eligible_amount),
          requireValue(response.max_loan_amount)
        );
        s.minimumAmount = requireValue(response.minimum_loan_amount);
        s.maxTenure = requireValue(response.max_tenure);
      } else {
        delete s.eligibleAmount;
        delete s.minimumAmount;
        delete s.maxTenure;
      }
      break;
    }
    case 'refresh_kyc':
      s.kyc = oxygenKycSchema.parse(await p.call('kyc', refs()));
      break;
    case 'validate_nin': {
      // Never resubmit NIN already complete or still processing.
      const kyc = oxygenKycSchema.parse(await p.call('kyc', refs()));
      s.kyc = kyc;
      // Recheck the provider prerequisite before any NIN mutation; saved state may be stale.
      if (kyc.selfie_status !== 'DONE') break;
      if (kyc.nin_status === 'NOT_DONE')
        z.object({ nin_status: z.enum(['DONE', 'PROCESSING']) }).parse(
          await p.call('nin', refs())
        );
      break;
    }
    case 'selfie_link':
      s.selfieUrl = hosted(
        z.object({ url: z.string() }).parse(await p.call('selfie', refs())).url,
        hosts
      );
      break;
    case 'book':
      await bookOxygenPlan(c, s, a, p);
      break;
    case 'submit_address': {
      if (!file || !validateOxygenFile(file.bytes, file.type, file.name))
        throw new Error('Valid address document required');
      const { action: _, ...address } = a;
      z.object({ message: z.literal('Address submitted successfully!') }).parse(
        await p.call('address', {
          ...refs(),
          ...address,
          file_name: file.name,
          content_type: file.type,
          residency_document: Buffer.from(file.bytes).toString('base64'),
        })
      );
      break;
    }
    case 'trigger_approval_otp':
      s.activityToken = z
        .object({ activity_token: z.string().min(1).max(16384) })
        .parse(await p.call('approval_otp', loan())).activity_token;
      break;
    case 'approve_booking': {
      if (
        !file ||
        !['image/jpeg', 'image/png'].includes(file.type) ||
        !validateOxygenFile(file.bytes, file.type, file.name)
      )
        throw new Error('Signature image required');
      const form = new FormData();
      form.set('loan_reference', requireValue(s.bookingReference));
      form.set('otp', a.otp);
      form.set('activity_token', requireValue(s.activityToken));
      form.set(
        'signature',
        new Blob([new Uint8Array(file.bytes)], { type: file.type }),
        file.name
      );
      const raw = await p.call('approve', form);
      const booking = oxygenBookingSchema.parse(raw);
      const links = z
        .object({
          repayment_setup_link: z.string().optional(),
          split_payment_link: z.string().optional(),
        })
        .parse(raw);
      if (
        booking.loan_reference !== s.bookingReference ||
        booking.status !== 'APPROVED' ||
        !s.booking ||
        booking.product_amount !== s.booking.product_amount ||
        booking.loan_amount !== s.booking.loan_amount ||
        booking.equity_amount !== s.booking.equity_amount ||
        booking.loan_tenure !== s.booking.loan_tenure ||
        booking.equity_percentage !== s.booking.equity_percentage ||
        booking.total_charges == null ||
        (s.quotedCharges !== undefined &&
          booking.total_charges !== s.quotedCharges) ||
        booking.total_upfront_payment == null ||
        toOxygenMinorUnits(booking.total_upfront_payment, 'NGN') !==
          toOxygenMinorUnits(booking.equity_amount, 'NGN') +
            toOxygenMinorUnits(booking.total_charges, 'NGN')
      )
        throw new Error('Approval terms mismatch');
      s.booking = booking;
      delete s.activityToken;
      if (links.split_payment_link)
        s.paymentUrl = hosted(links.split_payment_link, hosts);
      if (links.repayment_setup_link)
        s.setupUrl = hosted(links.repayment_setup_link, hosts);
      break;
    }
    case 'refresh_payment_setup': {
      const response = z
        .object({
          split_payment: z.object({ completed: z.boolean() }),
          repayment_setup: z.object({ completed: z.boolean() }),
        })
        .parse(await p.call('payment', loan()));
      s.paymentComplete = response.split_payment.completed;
      s.setupComplete = response.repayment_setup.completed;
      break;
    }
    case 'cancel_booking': {
      // Reconcile first: never cancel/rebook an already funded booking.
      const response = z
        .object({
          split_payment: z.object({ completed: z.boolean() }),
          repayment_setup: z.object({ completed: z.boolean() }),
        })
        .parse(await p.call('payment', loan()));
      if (response.split_payment.completed)
        throw new Error('Paid booking requires reconciliation');
      const cancel = z
        .object({ message: z.literal('Loan cancelled successfully') })
        .parse(await p.call('cancel', loan()));
      if (!/cancel/i.test(cancel.message))
        throw new Error('Cancellation unconfirmed');
      for (const key of [
        'bookingReference',
        'booking',
        'activityToken',
        'schedule',
        'quotedCharges',
        'paymentUrl',
        'setupUrl',
        'paymentComplete',
        'setupComplete',
      ] as const)
        delete s[key];
      break;
    }
    case 'refresh_details': {
      const details = parseOxygenBreakdown(
        await p.call('details', loan()),
        requireValue(s.booking).loan_tenure,
        requireValue(s.booking).loan_amount
      );
      s.schedule = details.schedule;
      if (details.quotedCharges !== undefined)
        s.quotedCharges = details.quotedCharges;
      break;
    }
  }
  return { stage: stageFor(s), state: s };
}
