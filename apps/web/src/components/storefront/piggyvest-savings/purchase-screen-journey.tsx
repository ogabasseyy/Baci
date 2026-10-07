'use client';
import { useState } from 'react';
import { CustomerSavingsStatus } from './customer-savings-status';
import { FundingPanel } from './funding-panel';
import { PolicyPanel } from './policy-panel';
import type {
  SavingsScreenProps,
  SavingsScreenSource,
} from './savings-screen.types';

function disconnectedAcceptance(): Promise<never> {
  return Promise.reject(new Error('Consent submission is not connected'));
}
export function PurchaseScreenJourney({
  source,
  submitPolicy,
  fundingBlocked,
}: {
  source: Extract<SavingsScreenSource, { status: 'ready' }>;
  submitPolicy: SavingsScreenProps['submitPolicy'];
  fundingBlocked: boolean;
}) {
  const [readers] = useState(() => ({
    policy: async () => source.policy,
    funding: async () => source.funding,
  }));
  const eligibility = source.eligibility;
  const allowed =
    !fundingBlocked &&
    source.policy.consent === 'accepted' &&
    eligibility.status === 'allowed' &&
    eligibility.sessionKey === source.sessionKey &&
    eligibility.goalId === source.goalId &&
    eligibility.revisionId === source.policy.revisionId &&
    eligibility.termsHash === source.policy.terms.hash &&
    eligibility.termsVersion === source.policy.terms.version;

  return (
    <div className="space-y-6">
      {!submitPolicy && source.policy.consent === 'required' && (
        <p>Consent submission is not connected.</p>
      )}
      <fieldset disabled={!submitPolicy} className="min-w-0">
        <legend className="sr-only">Draft consent review</legend>
        <PolicyPanel
          sessionKey={source.sessionKey}
          goalId={source.goalId}
          load={readers.policy}
          submit={submitPolicy ?? disconnectedAcceptance}
        />
      </fieldset>
      {allowed ? (
        <>
          <FundingPanel
            requestKey={JSON.stringify([
              source.sessionKey,
              source.goalId,
              source.policy.revisionId,
            ])}
            load={readers.funding}
          />
          {source.progress.status === 'ready' ? (
            <CustomerSavingsStatus
              {...source.progress}
              device={source.policy.device}
              decision={{
                ...source.progress.decision,
                purchaseAction: 'blocked',
              }}
              actionPending={false}
              onReviewPurchase={() => undefined}
            />
          ) : (
            <CustomerSavingsStatus
              {...source.progress}
              device={source.policy.device}
            />
          )}
        </>
      ) : (
        <p role="status">
          {eligibility.status === 'pending'
            ? 'Server eligibility is pending.'
            : eligibility.status === 'unavailable'
              ? 'Server eligibility is unavailable.'
              : 'Funding and savings progress require accepted terms and matching server eligibility.'}
        </p>
      )}
    </div>
  );
}
