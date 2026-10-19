export function isPiggyvestInterestRequestPath(
  path: string,
  isCanonicalIdentifier: (identifier: string) => boolean
): boolean {
  const match =
    /^\/api\/v1\/wallet\/interests\/accrued\/([^/?#]+)(?:\?([^#]+))?$/.exec(
      path
    );
  if (!match || !isCanonicalIdentifier(match[1])) return false;
  if (!match[2]) return true;
  const parameters = new URLSearchParams(match[2]);
  if (parameters.toString() !== match[2]) return false;
  const seen = new Set<string>();
  for (const [key, value] of parameters) {
    if (seen.has(key)) return false;
    seen.add(key);
    switch (key) {
      case 'start_date':
      case 'end_date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        if (
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        )
          return false;
        break;
      }
      case 'limit':
        if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 100) return false;
        break;
      case 'interest_type':
        if (value !== 'original' && value !== 'differential') return false;
        break;
      case 'cursor':
        if (
          value.length === 0 ||
          value.length > 512 ||
          Array.from(value).some((character) => {
            const code = character.charCodeAt(0);
            return code <= 31 || code === 127;
          })
        )
          return false;
        break;
      default:
        return false;
    }
  }
  const start = parameters.get('start_date');
  const end = parameters.get('end_date');
  return !(start && end && start > end);
}
