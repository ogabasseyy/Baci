import { GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './supabase-history-replay-gigl-wallet-sources';

export const EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES =
  GIGL_WALLET_SHIPPING_PENDING_SOURCES.trim()
    .split('\n')
    .map((row) => {
      const separator = row.indexOf(' ');
      if (separator < 1 || separator === row.length - 1) {
        throw new Error('Invalid GIGL wallet pending source row');
      }
      return {
        repositoryPath: `supabase/migrations/${row.slice(separator + 1)}`,
        sha256: row.slice(0, separator),
      };
    });
