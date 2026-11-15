import { useAuthStore } from '@/stores/auth-store';

/** The customer and store signed in now, as a notice scope key. */
export const currentSavingsNoticeScope = () => {
  const { user, merchantId } = useAuthStore.getState();
  return `${user?.id ?? ''}:${merchantId ?? ''}`;
};
