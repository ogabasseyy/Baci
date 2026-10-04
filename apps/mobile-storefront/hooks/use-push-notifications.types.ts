export type UsePushNotificationsReturn = {
  error: string | null;
  isLoading: boolean;
  isRegistered: boolean;
  pushToken: string | null;
  registeredUserId: string | null;
  register: (
    userId?: string,
    merchantId?: string,
    opts?: { force?: boolean }
  ) => Promise<void>;
  unregister: () => Promise<void>;
};
