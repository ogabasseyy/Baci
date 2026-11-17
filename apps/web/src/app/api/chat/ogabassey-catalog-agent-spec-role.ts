const CAPACITY_SPEC_UNITS = new Set(['mb', 'gb', 'tb']);

const ROLE_CONTEXT_STOP =
  /[.,;!?\n/&|]|\b(?:and|or|with|plus)\b|\b[a-z]+\s*:|\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

const BEFORE_CONTEXT_STOP =
  /[.,;!?\n/&|]|\b(?:and|or|with|plus)\b|\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

const STORAGE_ATTRIBUTE_ROLE =
  /\b(?:storage|ssd|hdd|nvme|emmc|ufs|rom|internal\s+memory|memory\s+card|flash\s+memory|built-?in\s+memory|internal|flash|hard\s+drive|disk)\b/gi;

const RAM_ATTRIBUTE_ROLE =
  /\b(?:ram|unified\s+memory|system\s+memory|memory|(?:lp)?ddr\d*[a-z]?|sdram)\b/gi;

interface RoleCandidate {
  role: 'ram' | 'storage';
  distance: number;
}

function findRoleCandidate(
  context: string,
  direction: 'after' | 'before'
): RoleCandidate | undefined {
  const storageMatches = [...context.matchAll(STORAGE_ATTRIBUTE_ROLE)];
  const ramMatches = [...context.matchAll(RAM_ATTRIBUTE_ROLE)];
  const distAfter = (match: RegExpMatchArray | undefined) => match?.index;
  const distBefore = (match: RegExpMatchArray | undefined) =>
    match?.index !== undefined
      ? context.length - (match.index + match[0].length)
      : undefined;

  const sDist =
    direction === 'after'
      ? distAfter(storageMatches[0])
      : distBefore(storageMatches.at(-1));
  const rDist =
    direction === 'after'
      ? distAfter(ramMatches[0])
      : distBefore(ramMatches.at(-1));

  if (sDist === undefined && rDist === undefined) return undefined;
  if (sDist === undefined && rDist !== undefined) {
    return { role: 'ram', distance: rDist };
  }
  if (rDist === undefined && sDist !== undefined) {
    return { role: 'storage', distance: sDist };
  }
  if (sDist !== undefined && rDist !== undefined) {
    return sDist <= rDist
      ? { role: 'storage', distance: sDist }
      : { role: 'ram', distance: rDist };
  }
  return undefined;
}

/** Classifies whether a capacity spec (MB/GB/TB) refers to RAM or storage using surrounding labels. */
export function extractCapacitySpecRole(
  source: string,
  start: number,
  end: number,
  rawUnit: string | undefined
): 'ram' | 'storage' | undefined {
  if (!rawUnit || !CAPACITY_SPEC_UNITS.has(rawUnit.toLowerCase())) {
    return undefined;
  }
  const after =
    source
      .slice(end, Math.min(source.length, end + 24))
      .split(ROLE_CONTEXT_STOP)[0] ?? '';
  const before =
    source
      .slice(Math.max(0, start - 20), start)
      .split(BEFORE_CONTEXT_STOP)
      .at(-1) ?? '';

  const afterCandidate = findRoleCandidate(after, 'after');
  const beforeCandidate = findRoleCandidate(before, 'before');
  if (!afterCandidate) return beforeCandidate?.role;
  if (!beforeCandidate) return afterCandidate.role;
  return afterCandidate.distance <= beforeCandidate.distance
    ? afterCandidate.role
    : beforeCandidate.role;
}
