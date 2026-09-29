'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { SearchAutocompleteProps } from '@/components/storefront/search-autocomplete';
import { parseStorefrontSearchQueryParam } from '@/lib/storefront-search-params';

/**
 * Maximum query the navbar accepts and submits. The search page itself
 * accepts up to 200 characters, so route-synced queries are normalized to
 * this limit: the input must never display a longer term than Enter would
 * submit (HTML maxLength does not truncate programmatic assignments).
 */
const NAVBAR_SEARCH_MAX_LENGTH = 100;

/**
 * Syncs the persistent navbar input when the active search route's query
 * changes underneath it (e.g. following a "Did you mean" link): the
 * shared layout keeps NavbarSearch mounted across that navigation, so
 * without this the input would keep showing the old term and Enter would
 * navigate back to the misspelled search. Reads the route inside its own
 * Suspense boundary so static prerenders never touch useSearchParams.
 */
function SearchRouteQuerySync({ onSync }: { onSync: (query: string) => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The value mirrors the route parser exactly: repeated or missing `q`
  // params yield the same empty query the results page renders (instead of
  // the first raw value), and the result is normalized to the navbar
  // limit so the displayed term always equals the submitted term.
  const routeQueries =
    pathname !== null && pathname.endsWith('/search')
      ? searchParams.getAll('q')
      : null;
  const routeQuery =
    routeQueries === null
      ? null
      : parseStorefrontSearchQueryParam(
          routeQueries.length === 1 ? (routeQueries[0] ?? '') : undefined
        ).slice(0, NAVBAR_SEARCH_MAX_LENGTH);

  useEffect(() => {
    // Runs only when the route query changes, so in-progress edits are
    // preserved while the route is unchanged; navigation always wins.
    if (routeQuery !== null) {
      onSync(routeQuery);
    }
  }, [routeQuery, onSync]);

  return null;
}

type SearchAutocompleteComponent = React.ComponentType<SearchAutocompleteProps>;

let searchAutocompleteLoader: Promise<SearchAutocompleteComponent> | null = null;

function loadSearchAutocomplete() {
  if (!searchAutocompleteLoader) {
    searchAutocompleteLoader = import('@/components/storefront/search-autocomplete').then(
      (mod) => mod.SearchAutocomplete
    );
  }

  return searchAutocompleteLoader;
}

interface NavbarSearchProps {
  basePath: string;
  isBlogPage: boolean;
  merchantId?: string;
}

const SEARCH_INPUT_CLASS_NAME =
  'ogabassey-navbar-search ogabassey-navbar-search--autocomplete';

export function NavbarSearch({
  basePath,
  isBlogPage,
  merchantId,
}: NavbarSearchProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [SearchAutocompleteComponent, setSearchAutocompleteComponent] =
    useState<SearchAutocompleteComponent | null>(null);
  const [shouldAutoFocusAutocomplete, setShouldAutoFocusAutocomplete] =
    useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  if (!merchantId) {
    return null;
  }

  const pushSearchRoute = (query: string) => {
    const trimmedQuery = query.trim().slice(0, NAVBAR_SEARCH_MAX_LENGTH);
    if (!trimmedQuery) {
      return;
    }

    if (isBlogPage) {
      router.push(
        `${basePath}/blog?search=${encodeURIComponent(trimmedQuery)}` as `/${string}`
      );
      return;
    }

    router.push(
      `${basePath}/search?q=${encodeURIComponent(trimmedQuery)}` as `/${string}`
    );
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    pushSearchRoute(searchQuery);
  };

  const handleProductSelect = (url: string) => {
    const isValidRelativePath =
      url.startsWith('/') &&
      !url.startsWith('//') &&
      !url.includes('\\') &&
      !/^https?:\/\//i.test(url);

    if (!isValidRelativePath) {
      console.warn('Invalid product URL rejected:', url);
      return;
    }

    const fullUrl = basePath ? `${basePath}${url}` : url;
    router.push(fullUrl as `/${string}`);
  };

  const activateAutocomplete = (focusAutocomplete = false) => {
    if (focusAutocomplete) {
      setShouldAutoFocusAutocomplete(true);
    }

    if (SearchAutocompleteComponent || isBlogPage) {
      return;
    }

    void loadSearchAutocomplete().then((component) => {
      if (!isMountedRef.current) {
        return;
      }

      setSearchAutocompleteComponent(() => component);
    });
  };

  if (isBlogPage) {
    return (
      <form onSubmit={handleSubmit} className="ogabassey-navbar-search">
        <Suspense>
          <SearchRouteQuerySync onSync={setSearchQuery} />
        </Suspense>
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search blog posts..."
          maxLength={NAVBAR_SEARCH_MAX_LENGTH}
          aria-label="Search blog posts"
          id="blog-search-input"
          name="search"
          className="ogabassey-navbar-search__input"
        />
        <Search className="ogabassey-navbar-search__icon" aria-hidden="true" />
      </form>
    );
  }

  if (SearchAutocompleteComponent) {
    return (
      <>
        <Suspense>
          <SearchRouteQuerySync onSync={setSearchQuery} />
        </Suspense>
        <SearchAutocompleteComponent
          merchantId={merchantId}
        value={searchQuery}
        onChange={setSearchQuery}
        onSelectProduct={handleProductSelect}
        onSubmitSearch={pushSearchRoute}
        // Match the shared navbar limit (and the fallback input below)
        // so the persistent value can never exceed the submitted query.
        maxLength={NAVBAR_SEARCH_MAX_LENGTH}
        placeholder="Search products, brands and categories"
        className={SEARCH_INPUT_CLASS_NAME}
        autoFocus={shouldAutoFocusAutocomplete}
        />
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ogabassey-navbar-search">
      <Suspense>
        <SearchRouteQuerySync onSync={setSearchQuery} />
      </Suspense>
      <Search className="ogabassey-navbar-search__icon" aria-hidden="true" />
      <Input
        type="search"
        value={searchQuery}
        onChange={(event) => {
          setSearchQuery(event.target.value);
          activateAutocomplete(false);
        }}
        onFocus={() => activateAutocomplete(true)}
        onPointerDown={() => activateAutocomplete(false)}
        placeholder="Search products, brands and categories"
        maxLength={NAVBAR_SEARCH_MAX_LENGTH}
        aria-label="Search products"
        id="search-input"
        name="q"
        className="ogabassey-navbar-search__input"
      />
    </form>
  );
}
