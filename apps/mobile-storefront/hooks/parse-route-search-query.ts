import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from '@/constants/search';
import { isSearchableQuery } from './is-searchable-query';

/**
 * Validates the Expo Router `q` parameter before use. Repeated parameters
 * arrive as arrays and are ambiguous, so only a single string of at least
 * the search threshold is accepted; over-long direct deep links truncate
 * to the shared maximum so unbounded input never reaches the search RPC.
 * Queries that normalize to nothing (e.g. punctuation-only deep links)
 * are rejected: the fetch would resolve them to zero matches.
 */
export function parseRouteSearchQuery(
  param: string | string[] | undefined
): string | null {
  if (typeof param !== 'string') {
    return null;
  }

  const trimmed = param.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
    return null;
  }
  return isSearchableQuery(trimmed) ? trimmed : null;
}
