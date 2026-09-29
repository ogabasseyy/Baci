import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from '@/constants/search';
import { isSearchableQuery } from './is-searchable-query';

interface UseHomeSearchControlsInput {
  isFocused: boolean;
  onSearchOpen: () => void;
}

/**
 * Owns the home search overlay state and the submit path to `/search`.
 * Short queries stay in the input with a minimum-length hint; valid
 * submissions close the dropdown, release input focus, and navigate once.
 */
export function useHomeSearchControls({
  isFocused,
  onSearchOpen,
}: UseHomeSearchControlsInput) {
  const searchVisibleShared = useSharedValue(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchMinLengthHint, setShowSearchMinLengthHint] = useState(false);
  // Guards against a second push while the first /search navigation is in
  // flight (double submit from keyboard + action press in quick succession).
  const searchNavigatingRef = useRef(false);

  const handleSearch = () => {
    searchVisibleShared.set(true);
    onSearchOpen();
    setSearchVisible(true);
  };

  const handleSearchCancel = () => {
    searchVisibleShared.set(false);
    setSearchVisible(false);
    setSearchQuery('');
    setShowSearchMinLengthHint(false);
  };

  const submitHomeSearch = (rawQuery: string) => {
    const trimmedQuery = rawQuery.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    // Punctuation-only input passes the length check but normalizes to
    // nothing, which the product fetch resolves to zero matches: keep it
    // in the input with the hint instead of navigating to a misleading
    // no-results journey for a query that was never searchable.
    if (
      trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH ||
      !isSearchableQuery(trimmedQuery)
    ) {
      setShowSearchMinLengthHint(true);
      return;
    }
    if (searchNavigatingRef.current) {
      return;
    }
    searchNavigatingRef.current = true;
    setShowSearchMinLengthHint(false);
    // Capture the query, then close the dropdown and release input focus
    // before navigating so the home screen is clean on return.
    searchVisibleShared.set(false);
    setSearchVisible(false);
    Keyboard.dismiss();
    router.push({ pathname: '/search', params: { q: trimmedQuery } });
  };

  const handleSearchSubmit = () => {
    submitHomeSearch(searchQuery);
  };

  const handleSeeAllResults = (query: string) => {
    submitHomeSearch(query);
  };

  const handleSearchQueryChange = (text: string) => {
    // Bound at acceptance so the controlled state — input display,
    // dropdown suggestions, see-all label, submitted route param — can
    // never exceed the shared maximum, even for over-long pastes. The
    // submit path keeps its own slice for direct suggestion strings.
    const boundedQuery = text.slice(0, MAX_SEARCH_QUERY_LENGTH);
    setSearchQuery(boundedQuery);
    if (
      showSearchMinLengthHint &&
      boundedQuery.trim().length >= MIN_SEARCH_QUERY_LENGTH &&
      isSearchableQuery(boundedQuery)
    ) {
      setShowSearchMinLengthHint(false);
    }
  };

  // Re-arm submission when home regains focus (back navigation from /search
  // or a product opened from the dropdown).
  useEffect(() => {
    if (isFocused) {
      searchNavigatingRef.current = false;
    }
  }, [isFocused]);

  return {
    handleSearch,
    handleSearchCancel,
    handleSearchQueryChange,
    handleSearchSubmit,
    handleSeeAllResults,
    searchQuery,
    searchVisible,
    searchVisibleShared,
    showSearchMinLengthHint,
  };
}
