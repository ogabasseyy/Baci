export function isNetworkDeviceCategory(categoryName: string) {
  const normalized = categoryName
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');

  return /\b(?:cellular routers?|mobile hotspots?|hotspots?|mifis?|mi fi|modems?)\b/.test(
    normalized
  );
}
