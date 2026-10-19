import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type PermissionType = 'notifications';
type NotificationsPermissionModule = Partial<
  Pick<
    typeof import('expo-notifications'),
    'getPermissionsAsync' | 'requestPermissionsAsync'
  >
>;
type MaybeNotificationsPermissionModule =
  | NotificationsPermissionModule
  | null
  | undefined;

interface PermissionState {
  // Track last request time for cool-down logic
  lastRequestTime: Record<PermissionType, number | null>;
  // Track how many times user deny the soft ask
  denialCounts: Record<PermissionType, number>;
  // Value to check if we should show the modal
  shouldShowModal: (type: PermissionType) => boolean;
  // Actions
  markRequested: (type: PermissionType) => void;
  markDenied: (type: PermissionType) => void;
  reset: () => void;
}

export const PERMISSION_SOFT_ASK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let notificationsModulePromise: Promise<NotificationsPermissionModule | null> | null =
  null;
type NotificationsModuleLoader =
  () => PromiseLike<NotificationsPermissionModule>;

function hasNotificationStatusApi(
  notifications: MaybeNotificationsPermissionModule
): notifications is NotificationsPermissionModule & {
  getPermissionsAsync: NonNullable<
    NotificationsPermissionModule['getPermissionsAsync']
  >;
} {
  return typeof notifications?.getPermissionsAsync === 'function';
}

function hasNotificationRequestApi(
  notifications: MaybeNotificationsPermissionModule
): notifications is NotificationsPermissionModule & {
  requestPermissionsAsync: NonNullable<
    NotificationsPermissionModule['requestPermissionsAsync']
  >;
} {
  return typeof notifications?.requestPermissionsAsync === 'function';
}

function warnNotificationsPermissionApiUnavailable(method: string) {
  // Pass the dynamic method name as a separate console argument rather than
  // interpolating it into the format string, so it is never treated as a
  // format specifier (avoids the unsafe-format-string class of issue).
  console.warn('Notification permission API unavailable:', method);
}

function warnNotificationsPermissionApiFailed(method: string, error: unknown) {
  console.warn('Notification permission API failed:', method, error);
}

export async function getNotificationPermissionStatus(
  notifications: MaybeNotificationsPermissionModule
): Promise<string | null> {
  if (!hasNotificationStatusApi(notifications)) {
    warnNotificationsPermissionApiUnavailable('getPermissionsAsync');
    return null;
  }

  try {
    const settings = await notifications.getPermissionsAsync();
    return settings.status;
  } catch (error) {
    warnNotificationsPermissionApiFailed('getPermissionsAsync', error);
    return null;
  }
}

export async function requestNotificationPermissionStatus(
  notifications: MaybeNotificationsPermissionModule
): Promise<boolean> {
  if (!hasNotificationRequestApi(notifications)) {
    warnNotificationsPermissionApiUnavailable('requestPermissionsAsync');
    return false;
  }

  try {
    const { status } = await notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    warnNotificationsPermissionApiFailed('requestPermissionsAsync', error);
    return false;
  }
}

export async function loadNotificationsModule(
  loadModule: NotificationsModuleLoader = () => import('expo-notifications')
): Promise<NotificationsPermissionModule | null> {
  try {
    // Expo SDK 57's native asyncRequire returns a thenable without .catch or
    // .finally. Await assimilates it without relying on those Promise methods.
    return await loadModule();
  } catch (error) {
    warnNotificationsPermissionApiFailed('expo-notifications', error);
    return null;
  }
}

export function loadNotifications(
  loadModule: NotificationsModuleLoader = () => import('expo-notifications')
) {
  if (!notificationsModulePromise) {
    notificationsModulePromise = loadNotificationsModule(loadModule).then(
      (notifications) => {
        // A synchronous native loader failure is caught before
        // loadNotificationsModule() returns its promise. Reset here, after
        // the cache has been assigned, so the next request can retry.
        if (notifications === null) {
          notificationsModulePromise = null;
        }
        return notifications;
      }
    );
  }
  return notificationsModulePromise;
}

export const usePermissionStore = create<PermissionState>()(
  persist(
    (set, get) => ({
      lastRequestTime: {
        notifications: null,
      },
      denialCounts: {
        notifications: 0,
      },
      shouldShowModal: (type) => {
        const { lastRequestTime, denialCounts } = get();
        const lastTime = lastRequestTime[type];
        const count = denialCounts[type];

        // If never requested, show it
        if (!lastTime) return true;

        // If denied less than 3 times, check cool-down
        if (count < 3) {
          const now = Date.now();
          return now - lastTime > PERMISSION_SOFT_ASK_COOLDOWN_MS;
        }

        // If denied 3+ times, don't show again (or wait much longer/manual trigger only)
        return false;
      },
      markRequested: (type) => {
        set((state) => ({
          lastRequestTime: {
            ...state.lastRequestTime,
            [type]: Date.now(),
          },
        }));
      },
      markDenied: (type) => {
        set((state) => ({
          denialCounts: {
            ...state.denialCounts,
            [type]: state.denialCounts[type] + 1,
          },
          lastRequestTime: {
            ...state.lastRequestTime,
            [type]: Date.now(), // Reset cool-down start
          },
        }));
      },
      reset: () => {
        set({
          lastRequestTime: { notifications: null },
          denialCounts: { notifications: 0 },
        });
      },
    }),
    {
      name: 'permission-booster-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/**
 * Hook to manage permissions with Soft Ask logic
 */
export const usePermissionBooster = () => {
  // Selecting all 6/6 store properties with useShallow provides no
  // performance benefit — revert to the bare hook.
  const store = usePermissionStore();

  const requestPermission = async (
    type: PermissionType
  ): Promise<'granted' | 'denied' | 'soft-ask-needed'> => {
    // 1. Check current system status
    const notifications = await loadNotifications();
    const status = await getNotificationPermissionStatus(notifications);
    if (!status) {
      return 'denied';
    }

    // If already granted, nothing to do
    if (status === 'granted') return 'granted';

    // If not granted, check if we should show soft ask
    if (store.shouldShowModal(type)) {
      return 'soft-ask-needed';
    }

    return 'denied';
  };

  const triggerSystemPrompt = async (
    type: PermissionType
  ): Promise<boolean> => {
    store.markRequested(type);

    const notifications = await loadNotifications();
    return await requestNotificationPermissionStatus(notifications);
  };

  return {
    ...store,
    requestPermission,
    triggerSystemPrompt,
  };
};
