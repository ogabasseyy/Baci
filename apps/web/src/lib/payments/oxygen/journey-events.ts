import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';

export type OxygenJourneyStage =
  | OxygenWorkflowStage
  | 'loading'
  | 'identity'
  | 'bank'
  | 'income'
  | 'phone'
  | 'verification'
  | 'selfie'
  | 'eligibility'
  | 'address'
  | 'address_review'
  | 'offer'
  | 'upfront_payment'
  | 'repayment_setup';
type JourneyEvent =
  | 'opened'
  | 'closed'
  | 'page_left'
  | 'stage_reached'
  | 'step_completed'
  | 'action_started'
  | 'action_response_received'
  | 'action_unconfirmed'
  | 'load_failed';

/** Deliberately accepts no form values, URLs, provider payloads or error text. */
export function trackOxygenJourney(
  event: JourneyEvent,
  orderId: string,
  stage: OxygenJourneyStage,
  action?: OxygenRuntimeAction['action']
) {
  captureClientEvent(`oxygen_application_${event}`, {
    order_id: orderId,
    provider: 'oxygen',
    stage,
    ...(action ? { action } : {}),
  });
}
