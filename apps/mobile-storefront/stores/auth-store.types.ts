import type { Session, User } from '@supabase/supabase-js';
import type { DeleteAccountResult } from '../lib/account-deletion';

export interface Customer {
  id: string;
  merchant_id?: string;
  user_id?: string | null;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  loyalty_points?: number;
  username?: string | null;
  username_changed_at?: string | null;
  /** Authoritative username cooldown returned by the username RPC. */
  username_next_eligible_at?: string | null;
  date_of_birth?: string | null;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  customer: Customer | null;
  merchantId: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  _initGen: number;
  _authSubscription: { subscription: { unsubscribe: () => void } } | null;
  _initializationInProgress: boolean;
  initialize: () => Promise<void>;
  cleanup: () => void;
  signInWithOtp: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; error?: string }>;
  signInWithPassword: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  signInWithApple: () => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<DeleteAccountResult>;
  refreshSession: () => Promise<void>;
  updateProfile: (
    data: Partial<Customer>
  ) => Promise<{ success: boolean; error?: string }>;
  setUsername: (
    username: string
  ) => Promise<{ success: boolean; error?: string; username?: string }>;
  setDateOfBirth: (
    dateOfBirth: string
  ) => Promise<{ success: boolean; error?: string; dateOfBirth?: string }>;
  clearError: () => void;
}

export type AuthStoreSet = (state: Partial<AuthState>) => void;
export type AuthStoreGet = () => AuthState;
