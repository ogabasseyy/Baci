'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { SearchAutocompleteProps } from '@/components/storefront/search-autocomplete';

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
    const trimmedQuery = query.trim().slice(0, 100);
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
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search blog posts..."
          maxLength={100}
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
      <SearchAutocompleteComponent
        merchantId={merchantId}
        value={searchQuery}
        onChange={setSearchQuery}
        onSelectProduct={handleProductSelect}
        onSubmitSearch={pushSearchRoute}
        // Match pushSearchRoute's 100-character truncation (and the
        // fallback input below) so the persistent value can never exceed
        // the submitted query.
        maxLength={100}
        placeholder="Search products, brands and categories"
        className={SEARCH_INPUT_CLASS_NAME}
        autoFocus={shouldAutoFocusAutocomplete}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ogabassey-navbar-search">
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
        maxLength={100}
        aria-label="Search products"
        id="search-input"
        name="q"
        className="ogabassey-navbar-search__input"
      />
    </form>
  );
}
