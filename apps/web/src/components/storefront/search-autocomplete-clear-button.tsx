import { X } from 'lucide-react';

interface SearchAutocompleteClearButtonProps {
  onClear: () => void;
}

/**
 * The input's clear (X) action. Geometry has TWO sources (see the icon
 * comment in search-autocomplete.tsx): core CSS
 * (.ogabassey-navbar-search__clear) for storefront `source(none)` routes,
 * and these Tailwind utilities for contexts that source the component but
 * do not load core CSS (the platform template-preview).
 * `-translate-y-1/2` uses the `translate` property core CSS also uses, so
 * the two never stack into a double offset.
 */
export function SearchAutocompleteClearButton({
  onClear,
}: SearchAutocompleteClearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="ogabassey-navbar-search__clear absolute right-1 top-1/2 -translate-y-1/2 size-8 flex items-center justify-center z-20 text-muted-foreground hover:text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
      aria-label="Clear search"
    >
      <X className="size-4" />
    </button>
  );
}
