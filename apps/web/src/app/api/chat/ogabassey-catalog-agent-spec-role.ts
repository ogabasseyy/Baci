const CAPACITY_SPEC_UNITS = new Set(['mb', 'gb', 'tb']);

const ROLE_CONTEXT_STOP =
  /[.,;!?\n/&|]|\b(?:and|or|with|plus)\b|\b[a-z]+\s*:|\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

const BEFORE_CONTEXT_STOP =
  /[.,;!?\n/&|]|\b(?:and|or|with|plus)\b|\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

const STORAGE_ATTRIBUTE_ROLE =
  /\b(?:storage|ssd|hdd|nvme|emmc|ufs|rom|internal\s+memory|memory\s+card|flash\s+memory|built-?in\s+memory|internal|flash|hard\s+drive|disk)\b/gi;

const RAM_ATTRIBUTE_ROLE =
  /\b(?:ram|unified\s+memory|system\s+memory|memory|(?:lp)?ddr\d*[a-z]?|sdram)\b/gi;

const PRIOR_CAPACITY_SUFFIX =
  /\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\s*$/i;

const NEXT_CAPACITY_PREFIX =
  /^\s*[:\-–]?\s*\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

function isPriorSpecSuffix(source: string, absStart: number): boolean {
  const windowStart = Math.max(0, absStart - 20);
  const priorMatch = PRIOR_CAPACITY_SUFFIX.exec(
    source.slice(windowStart, absStart)
  );
  if (!priorMatch) return false;
  const priorSpecStart = windowStart + priorMatch.index;
  const beforePrior = source.slice(
    Math.max(0, priorSpecStart - 20),
    priorSpecStart
  );
  return (
    beforePrior.search(STORAGE_ATTRIBUTE_ROLE) === -1 &&
    beforePrior.search(RAM_ATTRIBUTE_ROLE) === -1
  );
}

interface RoleCandidate {
  role: 'ram' | 'storage';
  distance: number;
  attachedToAdjacentSpec: boolean;
}

function findRoleCandidate(
  source: string,
  sliceOffset: number,
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

  const sMatch =
    direction === 'after' ? storageMatches[0] : storageMatches.at(-1);
  const rMatch = direction === 'after' ? ramMatches[0] : ramMatches.at(-1);
  const sDist = direction === 'after' ? distAfter(sMatch) : distBefore(sMatch);
  const rDist = direction === 'after' ? distAfter(rMatch) : distBefore(rMatch);

  let chosenRole: 'ram' | 'storage' | undefined;
  let chosenMatch: RegExpMatchArray | undefined;
  let distance: number | undefined;
  if (sDist !== undefined && (rDist === undefined || sDist <= rDist)) {
    chosenRole = 'storage';
    chosenMatch = sMatch;
    distance = sDist;
  } else if (rDist !== undefined) {
    chosenRole = 'ram';
    chosenMatch = rMatch;
    distance = rDist;
  }
  if (!chosenRole || chosenMatch?.index === undefined || distance === undefined)
    return undefined;

  const absStart = sliceOffset + chosenMatch.index;
  const absEnd = absStart + chosenMatch[0].length;
  const attachedToAdjacentSpec =
    direction === 'before'
      ? isPriorSpecSuffix(source, absStart)
      : NEXT_CAPACITY_PREFIX.test(source.slice(absEnd, absEnd + 20));
  return { role: chosenRole, distance, attachedToAdjacentSpec };
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
  const beforeStart = Math.max(0, start - 20);
  const rawBefore = source.slice(beforeStart, start);
  const beforeParts = rawBefore.split(BEFORE_CONTEXT_STOP);
  const before = beforeParts.at(-1) ?? '';
  const beforeOffset = start - before.length;

  const afterCandidate = findRoleCandidate(source, end, after, 'after');
  const beforeCandidate = findRoleCandidate(
    source,
    beforeOffset,
    before,
    'before'
  );
  const validBefore =
    beforeCandidate && !beforeCandidate.attachedToAdjacentSpec
      ? beforeCandidate
      : undefined;

  if (!validBefore) return afterCandidate?.role;
  if (!afterCandidate) return validBefore.role;
  if (afterCandidate.attachedToAdjacentSpec) return validBefore.role;
  return afterCandidate.distance <= validBefore.distance
    ? afterCandidate.role
    : validBefore.role;
}
