import { STOREFRONT_SEARCH_MAX_QUERY_LENGTH } from '@/lib/storefront-search-params';

interface SearchPageFormProps {
  action: string;
  defaultQuery: string;
}

export function SearchPageForm({ action, defaultQuery }: SearchPageFormProps) {
  return (
    <form
      method="get"
      action={action}
      aria-label="Edit search"
      className="mt-6 flex max-w-xl gap-2"
    >
      <label htmlFor="search-page-input" className="sr-only">
        Search products
      </label>
      <input
        // Remount per route query: client-side navigation (did-you-mean
        // links, the persistent navbar) reuses this uncontrolled input,
        // and defaultValue alone would keep showing the previous query.
        key={defaultQuery}
        id="search-page-input"
        name="q"
        type="search"
        defaultValue={defaultQuery}
        placeholder="Search products…"
        maxLength={STOREFRONT_SEARCH_MAX_QUERY_LENGTH}
        autoComplete="off"
        className="min-w-0 flex-1 rounded-xl border border-store-background-text/15 bg-store-background px-4 py-2.5 text-sm text-store-background-text placeholder:text-store-background-text/40 focus:border-store-primary focus:outline-hidden"
      />
      <button
        type="submit"
        className="shrink-0 rounded-xl bg-store-primary px-4 py-2.5 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}
