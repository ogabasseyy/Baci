export interface AutocompleteProduct {
  id: string;
  name: string;
  slug?: string;
  category?: string; // Backward compatibility (TEXT column - deprecated)
  category_id?: string; // FK to categories table
  categories?: {
    id: string;
    name: string;
    slug?: string;
  }; // Joined category object
  condition?: 'new' | 'used' | string;
  condition_detail?: string;
  price: number;
  image_small: string;
}

export interface AutocompletePopularSearch {
  search_query: string;
  search_count: number;
}

export interface SearchAutocompleteProps {
  merchantId: string;
  value: string;
  onChange: (value: string) => void;
  onSelectProduct?: (url: string) => void;
  /**
   * Explicit full-search submission (e.g. navigate to a results page).
   * When provided, Enter with no highlighted option submits the current
   * input instead of opening the first product suggestion. When omitted,
   * the legacy first-product behavior is preserved.
   */
  onSubmitSearch?: (query: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  countryCode?: string | null;
  payoutCurrency?: string | null;
}
