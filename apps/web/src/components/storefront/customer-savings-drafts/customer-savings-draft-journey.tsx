'use client';

import { ThemedButton } from '@/components/themed/themed-button';
import type { CustomerSavingsDraftScope } from '@/schemas/customer-savings-draft-public';
import { DraftCatalogue } from './draft-catalogue';
import { DraftReview } from './draft-review';
import { useCustomerSavingsDrafts } from './use-customer-savings-drafts';

export function CustomerSavingsDraftJourney(props: CustomerSavingsDraftScope) {
  if (!props.userId || !props.merchantId)
    return <p>Please sign in to start a savings draft.</p>;
  return (
    <DraftSession key={`${props.userId}:${props.merchantId}`} {...props} />
  );
}

function DraftSession(scope: CustomerSavingsDraftScope) {
  const model = useCustomerSavingsDrafts(scope);
  if (model.expired)
    return (
      <p role="alert">
        Your session changed or local drafts are unavailable. Please reopen your
        wallet after signing in.
      </p>
    );
  return (
    <section
      aria-label="Device savings drafts"
      aria-busy={model.busy}
      className="space-y-6 rounded-xl bg-store-background p-4 text-store-background-text sm:p-6"
    >
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Save for your device</h2>
        <p>
          Local test · No real money. Choose your exact device and review a
          saved draft.
        </p>
      </header>
      {model.error && <p role="alert">{model.error}</p>}
      {model.busy && <p role="status">Loading or saving your draft…</p>}
      {model.draft ? (
        <DraftReview
          key={model.draft.revisionId}
          draft={model.draft}
          busy={model.busy}
          canReplace={model.canReplace}
          onAccept={() => void model.accept()}
          onReplace={() => void model.replace()}
          onClose={model.close}
        />
      ) : (
        <>
          {model.canRetry && (
            <ThemedButton
              type="button"
              disabled={model.busy}
              onClick={() => void model.retry()}
            >
              Retry retained draft
            </ThemedButton>
          )}
          {model.drafts.length > 0 && (
            <section aria-label="Saved drafts" className="space-y-3">
              <h3 className="text-lg font-semibold">Your saved drafts</h3>
              <ul className="space-y-3">
                {model.drafts.map((saved) => (
                  <li key={saved.draftId}>
                    <ThemedButton
                      type="button"
                      variant="outline"
                      className="h-auto w-full flex-col items-start whitespace-normal text-left"
                      disabled={model.busy}
                      onClick={() => void model.open(saved.draftId)}
                    >
                      <span>
                        Open {saved.device.name} ·{' '}
                        {saved.device.variantLabel ?? saved.device.condition}
                      </span>
                      <span className="text-xs">
                        {saved.consent === 'accepted'
                          ? 'Consent saved'
                          : 'Needs your consent'}
                      </span>
                      <time dateTime={saved.createdAt} className="text-xs">
                        Created{' '}
                        {new Date(saved.createdAt).toLocaleString('en-NG', {
                          timeZone: 'Africa/Lagos',
                        })}
                      </time>
                    </ThemedButton>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ThemedButton
            type="button"
            variant="outline"
            disabled={model.busy}
            onClick={() => void model.refresh()}
          >
            Refresh my drafts and devices
          </ThemedButton>
          <DraftCatalogue
            products={model.products}
            page={model.cataloguePage}
            busy={model.busy}
            onSearch={(search, page) => void model.search(search, page)}
            onCreate={(selection) => void model.create(selection)}
          />
        </>
      )}
    </section>
  );
}
