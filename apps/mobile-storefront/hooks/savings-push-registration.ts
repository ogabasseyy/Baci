export type SavingsPushRegistrationIdentity = {
  key: string;
  userId: string;
  merchantId: string;
  token: string;
};

type RegistrationState = {
  userId: string | null;
  merchantId: string | null;
  token: string | null;
  registeredKey: string | null;
  isMounted: boolean;
};

type RegistrationOptions = {
  getState: () => RegistrationState;
  inFlight: { current: boolean };
  pending: { current: boolean };
  isEnabled: () => Promise<boolean>;
  prepare?: () => Promise<void>;
  hasPermission: () => Promise<boolean>;
  isOptedOut: (userId: string) => Promise<boolean>;
  save: (token: string, userId: string, merchantId: string) => Promise<boolean>;
  setIdentity: (identity: SavingsPushRegistrationIdentity | null) => void;
  setError: (error: string | null) => void;
};

export function savingsPushRegistrationKey(
  userId: string | null,
  merchantId: string | null,
  token: string | null
): string | null {
  if (!userId || !merchantId || !token) return null;
  return JSON.stringify([userId, merchantId, token]);
}

export async function retrySavingsPushRegistration({
  getState,
  inFlight,
  pending,
  isEnabled,
  prepare,
  hasPermission,
  isOptedOut,
  save,
  setIdentity,
  setError,
}: RegistrationOptions): Promise<void> {
  const initial = getState();
  if (
    !initial.isMounted ||
    !initial.userId ||
    !initial.merchantId ||
    !initial.token
  ) {
    return;
  }
  const key = savingsPushRegistrationKey(
    initial.userId,
    initial.merchantId,
    initial.token
  );
  if (!key || initial.registeredKey === key) return;
  if (inFlight.current) {
    pending.current = true;
    return;
  }

  const identity: SavingsPushRegistrationIdentity = {
    key,
    userId: initial.userId,
    merchantId: initial.merchantId,
    token: initial.token,
  };
  const isCurrent = () => {
    const current = getState();
    return (
      current.isMounted &&
      savingsPushRegistrationKey(
        current.userId,
        current.merchantId,
        current.token
      ) === identity.key &&
      current.registeredKey !== identity.key
    );
  };

  inFlight.current = true;
  try {
    if (!(await isEnabled()) || !isCurrent()) return;
    await prepare?.();
    if (!(await hasPermission()) || !isCurrent()) return;
    if ((await isOptedOut(identity.userId)) || !isCurrent()) return;

    const saved = await save(
      identity.token,
      identity.userId,
      identity.merchantId
    );
    if (!isCurrent()) return;

    setIdentity(saved ? identity : null);
    setError(saved ? null : 'Failed to register token with server');
  } catch {
    if (isCurrent()) setError('Failed to register token with server');
  } finally {
    inFlight.current = false;
    const shouldDrain = pending.current;
    pending.current = false;
    if (shouldDrain && getState().isMounted) {
      await retrySavingsPushRegistration({
        getState,
        inFlight,
        pending,
        isEnabled,
        prepare,
        hasPermission,
        isOptedOut,
        save,
        setIdentity,
        setError,
      });
    }
  }
}
