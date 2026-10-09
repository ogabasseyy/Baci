'use client';
import {
  ProductRequestSubmitError,
  submitProductRequest,
} from '@baci/shared/lib';
import { useRef, useState } from 'react';
import { initializeCsrfToken } from '@/lib/api-client';
import { getClientCsrfToken } from '@/lib/csrf';

/**
 * Request idempotency id that survives non-secure contexts: randomUUID
 * needs a secure context, but getRandomValues does not, and the server
 * requires a valid v4 UUID either way.
 */
function createProductRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
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
    try {
      // Id creation runs inside the guarded region: a throw here must
      // clear pending via finally rather than wedge the form.
      const key = JSON.stringify([product.trim(), contact.trim()]);
      if (key !== request.current.key)
        request.current = { key, id: createProductRequestId() };
      // Double-submit CSRF (the intake route requires it): reuse the
      // cookie token, minting one first for cold sessions that never
      // issued a state-changing call before this form.
      const csrfToken = getClientCsrfToken() ?? (await initializeCsrfToken());
      await submitProductRequest(
        '/api/storefront/product-requests',
        {
          query: product,
          contact,
          merchantSlug,
          requestId: request.current.id,
        },
        { csrfToken }
      );
      setSent(true);
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof ProductRequestSubmitError && error.status === 429
          ? 'Too many requests. Please try again later.'
          : error instanceof ProductRequestSubmitError && error.status === 409
            ? 'This request conflicts with an earlier one. Please try again.'
            : 'Couldn’t send. Check the product name and email or phone number, then try again.'
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
            request, not an order. Your request and contact details stay in the
            store’s inbox so the merchant can follow up.
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
