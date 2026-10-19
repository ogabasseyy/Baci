/**
 * useSearchStorage Hook
 * Manages search history and preferences persistence
 *
 * 2026 Best Practices:
 * - Specific type guards for storage validation
 * - Error boundary safe
 * - Syncs across instances via storage events (if needed)
 */

import { useEffect, useState } from 'react';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import { syncStorage as storage } from '@/lib/storage'; // Assuming this is the correct import based on search.tsx analysis
import { isSearchableQuery } from './is-searchable-query';

const SEARCH_HISTORY_KEY = 'search_history';
const MAX_SEARCH_HISTORY = 10;

// Module-level subscribers keep every mounted history reader (home dropdown,
// overlay, results screen) in sync: a write from one screen re-reads into the
// others without a remount, and the single persisted entry is never duplicated.
type SearchHistoryListener = () => void;
const searchHistoryListeners = new Set<SearchHistoryListener>();

function notifySearchHistoryChanged() {
  for (const listener of searchHistoryListeners) {
    listener();
  }
}

const DEFAULT_SEARCHES = [
  'iPhone 15 Pro',
  'Samsung Galaxy S24',
  'AirPods Pro',
  'MacBook Air',
  'Apple Watch',
];

/**
 * Read persisted search history synchronously, normalizing defensively:
 * blank, normalization-empty (e.g. "!!" persisted by older builds that
 * only length-checked), and case-duplicate entries are dropped so every
 * reader starts from the same clean, submittable list. Returns null when
 * nothing valid is persisted.
 */
function readPersistedSearchHistory(): string[] | null {
  try {
    const saved = storage.getItem(SEARCH_HISTORY_KEY);
    if (!saved) {
      return null;
    }
    const parsed: unknown = JSON.parse(saved);
    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === 'string')
    ) {
      const seen = new Set<string>();
      return parsed.filter((item) => {
        const normalized = item.trim().toLowerCase();
        if (
          !normalized ||
          seen.has(normalized) ||
          !isSearchableQuery(item.trim())
        ) {
          return false;
        }
        seen.add(normalized);
        return true;
      });
    }
  } catch (e) {
    // Fail silently, use defaults
    console.warn('Failed to load search history', e);
  }

  return null;
}

/**
 * Lazy useState initializer so the saved history is available on the first
 * render instead of being patched in by an effect.
 */
function loadInitialSearchHistory(): string[] {
  return readPersistedSearchHistory() ?? DEFAULT_SEARCHES;
}

export function useSearchStorage() {
  const [recentSearches, setRecentSearches] = useState<string[]>(
    loadInitialSearchHistory
  );

  // Re-read persisted history whenever another mounted instance writes, so a
  // term saved on the results screen appears in the still-mounted home
  // dropdown when the shopper navigates back.
  useEffect(() => {
    const reload = () => {
      setRecentSearches(readPersistedSearchHistory() ?? []);
    };
    searchHistoryListeners.add(reload);
    return () => {
      searchHistoryListeners.delete(reload);
    };
  }, []);

  const saveSearch = (searchTerm: string) => {
    // Mirror the submit gate exactly (length AND searchable): older
    // callers length-checked only, so punctuation-only input like "!!"
    // would persist as a chip that can never produce results.
    if (
      !searchTerm.trim() ||
      searchTerm.length < MIN_SEARCH_QUERY_LENGTH ||
      !isSearchableQuery(searchTerm.trim())
    )
      return;

    // Compute eagerly (not in a state updater) so persistence lands before
    // subscribers re-read, and subscriber setState never fires during this
    // component's render phase. Saves are discrete user events, so the state
    // snapshot is always fresh here.
    const filtered = recentSearches.filter(
      (s) => s.toLowerCase() !== searchTerm.toLowerCase()
    );
    const updated = [searchTerm, ...filtered].slice(0, MAX_SEARCH_HISTORY);
    // Notify only after successful persistence: the writer stays optimistic
    // when storage fails, and subscribers must not re-read stale storage
    // over any instance's in-memory state.
    let persisted = true;
    try {
      storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
      persisted = false;
      console.warn('Failed to save search history', e);
    }
    setRecentSearches(updated);
    if (persisted) {
      notifySearchHistoryChanged();
    }
  };

  const clearHistory = () => {
    let cleared = true;
    try {
      storage.removeItem(SEARCH_HISTORY_KEY);
    } catch (e) {
      cleared = false;
      console.warn('Failed to clear search history', e);
    }
    setRecentSearches([]);
    if (cleared) {
      notifySearchHistoryChanged();
    }
  };

  return {
    recentSearches,
    saveSearch,
    clearHistory,
  };
}
