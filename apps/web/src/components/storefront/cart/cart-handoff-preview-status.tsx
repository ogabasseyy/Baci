import { Button } from '@/components/ui/button';

export function CartHandoffPreviewStatus({
  destinationError,
  loadError,
  previewRetryable,
  retry,
}: {
  destinationError: string | null;
  loadError: string | null;
  previewRetryable: boolean;
  retry: () => void;
}) {
  const error = destinationError ?? loadError;
  return (
    <section aria-label="Cart handoff" className="mx-auto max-w-xl px-4 py-10">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">
            {destinationError
              ? 'We could not check your cart'
              : previewRetryable
                ? 'We could not load this cart link'
                : 'This cart link ended'}
          </h1>
          <p role="alert" className="mt-2 text-sm">
            {error}
          </p>
          {(destinationError || previewRetryable) && (
            <Button className="mt-4" onClick={retry}>
              Try again
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm">Loading your shared cart…</p>
      )}
    </section>
  );
}
