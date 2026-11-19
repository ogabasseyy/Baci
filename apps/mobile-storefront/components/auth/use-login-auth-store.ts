import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/stores/auth-store';

/** The slice of the auth store the login screen reads and calls. */
export function useLoginAuthStore() {
  return useAuthStore(
    useShallow((state) => ({
      signInWithOtp: state.signInWithOtp,
      verifyOtp: state.verifyOtp,
      signInWithGoogle: state.signInWithGoogle,
      isLoading: state.isLoading,
      signInWithPassword: state.signInWithPassword,
      signInWithApple: state.signInWithApple,
      user: state.user,
      isInitialized: state.isInitialized,
    }))
  );
}
