import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface PaystackBank {
  id: number;
  name: string;
  slug: string;
  code: string;
  active: boolean;
}

interface BanksResponse {
  banks?: PaystackBank[];
}

/**
 * Fetches the list of supported banks from the app backend.
 * Uses the canonical /api/paystack/banks route (public, no auth required).
 * Deduplicates banks by code to prevent duplicate entries in the picker.
 */
export function paystackBanksQueryOptions(timeout?: number) {
  return {
    queryKey:
      timeout === undefined ? ['paystack-banks'] : ['paystack-banks', timeout],
    queryFn: async () => {
      const data = await apiClient<BanksResponse>('/api/paystack/banks', {
        requiresAuth: false,
        ...(timeout === undefined ? {} : { timeout }),
      });
      const seen = new Set<string>();
      return (data.banks ?? []).filter((bank) => {
        if (seen.has(bank.code)) return false;
        seen.add(bank.code);
        return true;
      });
    },
    staleTime: 60 * 60 * 1000, // bank list changes rarely; cache for 1 hour
  };
}

export function usePaystackBanks() {
  return useQuery(paystackBanksQueryOptions());
}
