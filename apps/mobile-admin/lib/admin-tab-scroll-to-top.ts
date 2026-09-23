export type AdminTabScrollTarget = {
  scrollTo?: (options: { animated?: boolean; y: number }) => void;
  scrollToOffset?: (options: { animated?: boolean; offset: number }) => void;
};

const targets = new Map<string, () => AdminTabScrollTarget | null>();

export function registerAdminTabScrollTarget(
  routeName: string,
  getTarget: () => AdminTabScrollTarget | null
) {
  targets.set(routeName, getTarget);
  return () => {
    if (targets.get(routeName) === getTarget) targets.delete(routeName);
  };
}

export function scrollAdminTabToTop(routeName: string) {
  const target = targets.get(routeName)?.();
  if (target?.scrollToOffset) {
    target.scrollToOffset({ animated: true, offset: 0 });
    return true;
  }
  if (target?.scrollTo) {
    target.scrollTo({ animated: true, y: 0 });
    return true;
  }
  return false;
}
