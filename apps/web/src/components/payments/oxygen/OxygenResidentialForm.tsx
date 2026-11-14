'use client';
import { useRef, useState } from 'react';
import { OxygenAddressProgress } from './OxygenAddressProgress';
import { OxygenResidentialFields } from './OxygenResidentialFields';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import {
  type ResidentialProof,
  residentialAddress,
  residentialKeys,
} from './oxygen-residential-address';
import { useOxygenResidentialContext } from './use-oxygen-residential-context';
export function OxygenResidentialForm({
  workflowId,
  prepared,
  busy,
  submit,
}: {
  workflowId?: string;
  prepared?: ResidentialProof;
  busy: boolean;
  submit: SubmitOxygenForm;
}) {
  const context = useOxygenResidentialContext(workflowId);
  const [file, setFile] = useState<File | null>(prepared?.file ?? null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [enteredAddress, setEnteredAddress] =
    useState<ResidentialProof['address']>();
  if (sending) return <OxygenAddressProgress submitted={false} />;
  if (!context.ready)
    return (
      <p role="status" className="py-6 text-center text-sm text-gray-500">
        Preparing your address…
      </p>
    );
  return (
    <form
      aria-label="Verify address"
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || lock.current) return;
        if (!event.currentTarget.reportValidity()) return;
        if (!file) {
          setError('Attach a matching utility bill or proof of address.');
          return;
        }
        const values = new FormData(event.currentTarget);
        const address = residentialAddress(
          Object.fromEntries(
            residentialKeys.map((key) => [
              key,
              String(values.get(`home_${key}`) ?? ''),
            ])
          )
        );
        setEnteredAddress(address);
        lock.current = true;
        setSending(true);
        setError('');
        try {
          await submit({ action: 'submit_address', ...address }, file);
        } catch {
          setError(
            'We could not confirm your address submission. Check your saved progress before trying again.'
          );
        } finally {
          lock.current = false;
          setSending(false);
        }
      }}
    >
      <OxygenResidentialFields
        initial={enteredAddress ?? prepared?.address ?? context.address}
        checkout={
          !prepared && context.fromCheckout && Boolean(context.address.street)
        }
        file={file}
        onFile={setFile}
        disabled={busy || sending}
      />
      {error && (
        <p role="alert" className="text-sm text-store-primary">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || sending}
        className={oxygenButtonClass}
      >
        {sending ? 'Sending your address…' : 'Continue verification'}
      </button>
    </form>
  );
}
