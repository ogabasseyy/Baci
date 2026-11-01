export function validStoreIdentifier(identifier: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(identifier);
}

export function validRoutePath(route: string): boolean {
  try {
    return route.split('/').every((part) => {
      const decoded = decodeURIComponent(part);
      return (
        Boolean(decoded) &&
        decoded !== '.' &&
        decoded !== '..' &&
        !/[\\/?#]/.test(decoded) &&
        ![...decoded].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || code === 127;
        })
      );
    });
  } catch {
    return false;
  }
}
