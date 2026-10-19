'use client';

import { useState } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import type { CustomerSavingsDraft } from '@/schemas/customer-savings-draft-public';

export function DraftReview({
  draft,
  busy,
  canReplace,
  onAccept,
  onReplace,
  onClose,
}: {
  draft: CustomerSavingsDraft;
  busy: boolean;
  canReplace: boolean;
  onAccept: () => void;
  onReplace: () => void;
  onClose: () => void;
}) {
  const [checkedRevision, setCheckedRevision] = useState<string | null>(null);
  return (
    <section
      aria-label="Review saved draft"
      className="space-y-5 rounded-xl border border-store-primary/30 p-5"
    >
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">{draft.device.name}</h3>
        <p>
          {draft.device.condition} · {draft.device.variantLabel}
        </p>
        <p className="font-semibold">
          Saved catalogue price: ₦{draft.device.price.toLocaleString('en-NG')}
        </p>
        <p>This is not a price guarantee, stock reservation or activation.</p>
      </div>
      <h4 className="font-semibold">Draft disclosure</h4>
      <p className="whitespace-pre-wrap break-words">{draft.terms.text}</p>
      <p className="text-sm">Terms version: {draft.terms.version}</p>
      {draft.consent === 'accepted' ? (
        <p role="status">
          Your draft and consent are saved. Funding and interest are not
          activated.
        </p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={checkedRevision === draft.revisionId}
              disabled={busy || canReplace}
              onChange={(event) =>
                setCheckedRevision(
                  event.target.checked ? draft.revisionId : null
                )
              }
              className="mt-1 accent-[var(--store-primary)]"
            />
            I have reviewed and accept these draft terms
          </label>
          <ThemedButton
            type="button"
            disabled={
              busy || canReplace || checkedRevision !== draft.revisionId
            }
            onClick={onAccept}
          >
            Confirm draft terms
          </ThemedButton>
          {canReplace && (
            <div className="space-y-3">
              <p>
                The saved draft remains unchanged. Start a separate draft to
                review current details.
              </p>
              <ThemedButton
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCheckedRevision(null);
                  onReplace();
                }}
              >
                Start new draft
              </ThemedButton>
            </div>
          )}
        </div>
      )}
      <ThemedButton
        type="button"
        variant="outline"
        disabled={busy}
        onClick={onClose}
      >
        Back to my drafts
      </ThemedButton>
    </section>
  );
}
