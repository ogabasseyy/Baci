export function createFrameActivity(deps: {
  host: boolean;
  hostActive: () => boolean;
  isActive: () => Promise<boolean>;
  expiresAt: number;
  onInactive: () => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let initialBinding = deps.host && !deps.hostActive();
  let bindingCheckStarted = false;
  const bindingDeadline = now() + 10_000;
  const checkAdmission = () => {
    void Promise.resolve()
      .then(deps.isActive)
      .then((valid) => {
        if (!valid) deps.onInactive();
      })
      .catch(deps.onInactive);
  };

  return () => {
    if (!deps.host && now() >= deps.expiresAt) {
      deps.onInactive();
      return;
    }
    if (deps.host && !deps.hostActive()) {
      if (!initialBinding || now() >= bindingDeadline) {
        deps.onInactive();
      } else if (!bindingCheckStarted) {
        bindingCheckStarted = true;
        checkAdmission();
      }
      return;
    }
    initialBinding = false;
    if (!deps.host) checkAdmission();
  };
}
