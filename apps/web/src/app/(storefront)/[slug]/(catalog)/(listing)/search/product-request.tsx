'use client';
import { sendProductRequest } from '@baci/shared/lib';
import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
export function ProductRequest({
  query,
  merchantSlug,
}: {
  query: string;
  merchantSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState(query);
  const [contact, setContact] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const request = useRef({ key: '', id: '' });
  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError('');
    const key = JSON.stringify([product.trim(), contact.trim()]);
    if (key !== request.current.key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      await sendProductRequest(createClient(), {
        query: product,
        contact,
        merchantSlug,
        requestId: request.current.id,
      });
      setSent(true);
      setOpen(false);
    } catch {
      setError(
        'Couldn’t send. Check the product name and email or phone number, then try again.'
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  if (sent)
    return (
      <p role="status">
        Request sent to the store. They may contact you if they can source it.
      </p>
    );
  return (
    <div className="mx-auto mt-4 max-w-md text-store-background-text">
      {!open ? (
        <button
          type="button"
          className="min-h-11 rounded-xl border px-4"
          onClick={() => setOpen(true)}
        >
          Request this product
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-3 rounded-xl border border-store-background-text/15 p-4 text-left"
        >
          <h3 className="font-semibold">Request a product</h3>
          <p className="text-sm">
            Share what you need and how the store can contact you. This is a
            request, not an order.
          </p>
          <label className="block">
            Requested product
            <input
              required
              minLength={2}
              maxLength={120}
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              disabled={pending}
              className="block min-h-11 w-full rounded-lg border bg-store-background p-2"
            />
          </label>
          <label className="block">
            Email or phone number
            <input
              required
              minLength={5}
              maxLength={160}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              disabled={pending}
              className="block min-h-11 w-full rounded-lg border bg-store-background p-2"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-lg bg-store-primary px-4 text-store-primary-text"
          >
            {pending ? 'Sending…' : 'Send request'}
          </button>
          <button
            type="button"
            disabled={pending}
            className="ml-4 min-h-11"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
