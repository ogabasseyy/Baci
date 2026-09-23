export type AdminTabPress = { at: number; routeKey: string };

export function recordAdminTabPress(
  lastPress: AdminTabPress,
  routeKey: string,
  now: number,
  windowMs = 350
) {
  const isDoubleTap =
    lastPress.routeKey === routeKey && now - lastPress.at <= windowMs;
  return {
    isDoubleTap,
    nextPress: isDoubleTap ? { at: 0, routeKey: '' } : { at: now, routeKey },
  };
}
