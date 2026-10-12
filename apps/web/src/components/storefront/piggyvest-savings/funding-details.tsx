import { ThemedCard } from '@/components/themed/themed-card';
import type { FundingDetailsProps } from './funding-details.types';

const messages = {
  loading: 'Loading test funding details…',
  pending: 'Test funding details are pending confirmation.',
  unavailable: 'Test funding details are unavailable.',
  ready: 'Test funding details available.',
};

export function FundingDetails(props: FundingDetailsProps) {
  const accounts = props.status === 'ready' ? props.accounts : [];
  const status =
    props.status === 'ready' && accounts.length === 0
      ? 'unavailable'
      : props.status;

  return (
    <section aria-label="Funding details">
      <ThemedCard
        borderColor="primary"
        className="space-y-4 bg-store-background p-4 text-store-background-text"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Funding details</h2>
          <span className="rounded border border-store-primary px-2 py-1 text-sm">
            Staging
          </span>
        </div>
        <p>Test environment only. Do not send real money to these details.</p>
        <p role="status" aria-live="polite" aria-atomic="true">
          {messages[status]}
        </p>
        {accounts.map((account) => (
          <dl
            key={JSON.stringify([
              account.bankName,
              account.accountName,
              account.accountNumber,
            ])}
            className="space-y-2 break-words rounded border border-store-primary p-3"
          >
            <div>
              <dt className="text-sm">Bank</dt>
              <dd className="whitespace-pre-wrap">{account.bankName}</dd>
            </div>
            <div>
              <dt className="text-sm">Account name</dt>
              <dd className="whitespace-pre-wrap">{account.accountName}</dd>
            </div>
            <div>
              <dt className="text-sm">Account number</dt>
              <dd className="whitespace-pre-wrap font-semibold tabular-nums">
                {account.accountNumber}
              </dd>
            </div>
          </dl>
        ))}
      </ThemedCard>
    </section>
  );
}
