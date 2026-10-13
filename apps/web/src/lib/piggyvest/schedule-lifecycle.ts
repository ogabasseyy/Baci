import 'server-only';
import type { z } from 'zod';
import { piggyvestScheduleLifecycleSchemas as schemas } from '@/schemas/piggyvest-schedule-lifecycle';
import { evaluateSavingsPolicy } from './savings-policy';

type State = z.infer<typeof schemas.state>;

export function planPiggyvestScheduleLifecycle(input: unknown) {
  try {
    const { trusted, state, command } = schemas.input.parse(input);
    if (
      JSON.stringify(trusted.scope) !== JSON.stringify(state.scope) ||
      command.goalId !== trusted.scope.goalId ||
      command.expectedVersion !== state.version
    )
      throw new Error('Stale scope');
    if (
      command.action === 'request_resume' &&
      (command.revisionId !== trusted.revisionId ||
        command.termsHash !== trusted.termsHash)
    )
      throw new Error('Stale consent');

    const policy = evaluateSavingsPolicy(trusted.policy);
    const now = Date.parse(trusted.policy.now);
    const maturity = !trusted.maturity
      ? 'not_activated'
      : policy.maturity === 'review_required'
        ? 'review_required'
        : now >= Date.parse(trusted.maturity.maturesAt)
          ? 'within_grace'
          : 'before_maturity';
    let status: State['status'] = state.status;
    let consentProposal = state.consentProposal;
    let reason = 'fresh_resume_consent_required';
    const consentCurrent =
      consentProposal &&
      consentProposal.actorId === trusted.actorId &&
      consentProposal.revisionId === trusted.revisionId &&
      consentProposal.termsHash === trusted.termsHash;

    if (
      state.status === 'stopped' ||
      (policy.readiness === 'not_available' &&
        trusted.policy.goalState !== 'draft') ||
      policy.transition === 'blocked_by_existing_reservation'
    ) {
      status = 'stopped';
      reason = 'goal_or_reservation_blocks_collection';
    } else if (policy.readiness === 'review_required') {
      status = 'review_required';
      reason = 'authoritative_review_required';
    } else if (policy.readiness === 'ready_for_review') {
      status = 'paused';
      reason = 'ready_for_customer_review';
    } else if (trusted.collectionOwner !== 'piggyvest') {
      status = 'paused';
      reason = 'collection_owner_not_piggyvest';
    } else if (!trusted.policy.hasBeforeFundingConsent) {
      status = 'paused';
      reason = 'before_funding_consent_required';
    } else if (maturity === 'within_grace') {
      status = 'paused';
      reason = 'maturity_collection_contract_unresolved';
    } else if (
      trusted.policy.activationQuote &&
      now >= Date.parse(trusted.policy.activationQuote.expiresAt)
    ) {
      status = 'paused';
      reason = 'accepted_quote_expired';
    } else if (command.action === 'pause') {
      status = 'paused';
      reason = 'customer_pause_proposed';
    } else if (command.action === 'request_resume') {
      status = 'resume_proposed';
      reason = 'validated_proposal_only';
      consentProposal = {
        actorId: trusted.actorId,
        operationId: command.operationId,
        revisionId: command.revisionId,
        termsHash: command.termsHash,
      };
    } else if (!consentCurrent) {
      status = 'paused';
    } else if (status === 'resume_proposed') {
      reason = 'validated_proposal_only';
    }
    if (status !== 'resume_proposed') consentProposal = null;
    const changed =
      status !== state.status ||
      JSON.stringify(consentProposal) !== JSON.stringify(state.consentProposal);
    const stateProposal = schemas.state.parse({
      ...state,
      version: changed ? state.version + 1 : state.version,
      status,
      consentProposal,
    });
    return {
      stateProposal,
      reason,
      maturity,
      collectionPaused: true as const,
      dispatch: 'disabled' as const,
      due: 'cadence_contract_unresolved' as const,
      persisted: false as const,
    };
  } catch {
    throw new Error('Schedule lifecycle proposal unavailable');
  }
}
