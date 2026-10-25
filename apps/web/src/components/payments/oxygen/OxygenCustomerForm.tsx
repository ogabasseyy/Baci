'use client';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import {
  CustomerFormFields,
  type CustomerFormProps,
} from './OxygenCustomerFormFields';
import { useOxygenDraft } from './use-oxygen-draft';

export function OxygenCustomerForm(props: CustomerFormProps) {
  return <OxygenDraftSession key={props.workflowId ?? 'unsaved'} {...props} />;
}

function OxygenDraftSession(props: CustomerFormProps) {
  const draft = useOxygenDraft(props.workflowId);
  if (!draft.ready)
    return (
      <div
        role={draft.status === 'error' ? 'status' : undefined}
        className="text-sm text-gray-500"
      >
        {draft.status === 'error' ? (
          <>
            Unable to load your saved application.{' '}
            <button type="button" onClick={() => void draft.retry()}>
              Retry
            </button>
          </>
        ) : (
          <OxygenApplicationLoading />
        )}
      </div>
    );
  return (
    <div className="grid gap-3">
      {(draft.status === 'error' || draft.status === 'conflict') && (
        <div role="status" className="text-xs text-gray-500">
          {draft.status === 'error' ? (
            <>
              Unable to save.{' '}
              <button type="button" onClick={() => void draft.retry()}>
                Retry
              </button>
            </>
          ) : draft.status === 'conflict' ? (
            <>
              This application changed in another channel. Your latest edits
              have not been saved. Reload to use the saved progress.{' '}
              <button type="button" onClick={() => window.location.reload()}>
                Reload saved progress
              </button>
            </>
          ) : null}
        </div>
      )}
      <CustomerFormFields
        {...props}
        initialDraft={draft.initial}
        saveDraft={draft.queue}
        flushDraft={draft.flush}
        saveBlocked={draft.status === 'conflict'}
      />
    </div>
  );
}
