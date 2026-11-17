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
  /\b(\d+(?:\.\d+)?)[\s-]*(gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\s*$/i;

const NEXT_CAPACITY_PREFIX =
  /^\s*[:\-–]?\s*(\d+(?:\.\d+)?)[\s-]*(gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b/i;

function capacityToMb(num: number, unit: string): number {
  const lower = unit.toLowerCase();
  if (lower === 'tb') return num * 1024 * 1024;
  if (lower === 'gb') return num * 1024;
  return num;
}

function isPriorSpecSuffix(
  source: string,
  absStart: number,
  absEnd: number,
  chosenRole: 'ram' | 'storage',
  selfCapacityMb: number,
  afterCandidateRole?: 'ram' | 'storage'
): boolean {
  if (
    source
      .slice(absEnd, absEnd + 2)
      .trimStart()
      .startsWith(':')
  ) {
    return false;
  }
  const windowStart = Math.max(0, absStart - 20);
  const priorMatch = PRIOR_CAPACITY_SUFFIX.exec(
    source.slice(windowStart, absStart)
  );
  if (!priorMatch || !CAPACITY_SPEC_UNITS.has(priorMatch[2].toLowerCase())) {
    return false;
  }
  const priorSpecStart = windowStart + priorMatch.index;
  const beforePrior =
    source
      .slice(Math.max(0, priorSpecStart - 20), priorSpecStart)
      .split(BEFORE_CONTEXT_STOP)
      .at(-1) ?? '';
  const hasPriorDifferentRole =
    chosenRole === 'ram'
      ? beforePrior.search(STORAGE_ATTRIBUTE_ROLE) !== -1
      : beforePrior.search(RAM_ATTRIBUTE_ROLE) !== -1;
  if (hasPriorDifferentRole) {
    return false;
  }
  const hasOppositeAfterCandidate =
    afterCandidateRole !== undefined && afterCandidateRole !== chosenRole;
  const priorCapacityMb = capacityToMb(
    Number.parseFloat(priorMatch[1]),
    priorMatch[2]
  );
  if (
    !hasOppositeAfterCandidate &&
    chosenRole === 'ram' &&
    priorCapacityMb > selfCapacityMb
  ) {
    return false;
  }
  if (
    !hasOppositeAfterCandidate &&
    chosenRole === 'storage' &&
    selfCapacityMb > priorCapacityMb
  ) {
    return false;
  }
  return true;
}

function inspectNextSpec(
  source: string,
  absEnd: number,
  chosenRole: 'ram' | 'storage',
  selfCapacityMb: number
): { attached: boolean; followedByUnlabeledCapacity: boolean } {
  const nextMatch = NEXT_CAPACITY_PREFIX.exec(
    source.slice(absEnd, absEnd + 24)
  );
  if (!nextMatch) {
    return { attached: false, followedByUnlabeledCapacity: false };
  }
  const afterNextOffset = absEnd + nextMatch[0].length;
  const afterNext =
    source
      .slice(afterNextOffset, afterNextOffset + 24)
      .split(ROLE_CONTEXT_STOP)[0] ?? '';
  if (/\bvram\b/i.test(afterNext)) {
    return { attached: false, followedByUnlabeledCapacity: false };
  }
  const storageIdx = afterNext.search(STORAGE_ATTRIBUTE_ROLE);
  const ramIdx = afterNext.search(RAM_ATTRIBUTE_ROLE);
  const nearestAfterRole =
    storageIdx !== -1 && (ramIdx === -1 || storageIdx <= ramIdx)
      ? 'storage'
      : ramIdx !== -1
        ? 'ram'
        : undefined;
  if (
    nearestAfterRole &&
    (nearestAfterRole !== chosenRole || chosenRole !== 'ram')
  ) {
    return { attached: false, followedByUnlabeledCapacity: false };
  }
  if (
    source
      .slice(absEnd, absEnd + 2)
      .trimStart()
      .startsWith(':')
  ) {
    return { attached: true, followedByUnlabeledCapacity: false };
  }
  const followedByUnlabeledCapacity = CAPACITY_SPEC_UNITS.has(
    nextMatch[2].toLowerCase()
  );
  if (!followedByUnlabeledCapacity) {
    return { attached: false, followedByUnlabeledCapacity: false };
  }
  const nextCapacityMb = capacityToMb(
    Number.parseFloat(nextMatch[1]),
    nextMatch[2]
  );
  const attached =
    (chosenRole === 'ram' && selfCapacityMb > nextCapacityMb) ||
    (chosenRole === 'storage' && nextCapacityMb > selfCapacityMb);
  return { attached, followedByUnlabeledCapacity };
}

interface RoleCandidate {
  role: 'ram' | 'storage';
  distance: number;
  attachedToAdjacentSpec: boolean;
  followedByUnlabeledCapacity: boolean;
}

function findRoleCandidate(
  source: string,
  sliceOffset: number,
  context: string,
  direction: 'after' | 'before',
  selfCapacityMb: number,
  afterCandidateRole?: 'ram' | 'storage'
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
  if (direction === 'before') {
    return {
      role: chosenRole,
      distance,
      attachedToAdjacentSpec: isPriorSpecSuffix(
        source,
        absStart,
        absEnd,
        chosenRole,
        selfCapacityMb,
        afterCandidateRole
      ),
      followedByUnlabeledCapacity: false,
    };
  }
  const nextSpec = inspectNextSpec(source, absEnd, chosenRole, selfCapacityMb);
  return {
    role: chosenRole,
    distance,
    attachedToAdjacentSpec: nextSpec.attached,
    followedByUnlabeledCapacity: nextSpec.followedByUnlabeledCapacity,
  };
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
  const selfCapacityMb = capacityToMb(
    Number.parseFloat(source.slice(start, end)),
    rawUnit
  );
  const after =
    source
      .slice(end, Math.min(source.length, end + 24))
      .split(ROLE_CONTEXT_STOP)[0] ?? '';
  const beforeStart = Math.max(0, start - 20);
  const rawBefore = source.slice(beforeStart, start);
  const beforeParts = rawBefore.split(BEFORE_CONTEXT_STOP);
  const before = beforeParts.at(-1) ?? '';
  if (
    /^\s*(?:of\s+)?[:\-–]?\s*vram\b/i.test(after) ||
    /\bvram\s*[:\-–]?\s*$/i.test(before)
  ) {
    return undefined;
  }
  const beforeOffset = start - before.length;

  const afterCandidate = findRoleCandidate(
    source,
    end,
    after,
    'after',
    selfCapacityMb
  );
  const beforeCandidate = findRoleCandidate(
    source,
    beforeOffset,
    before,
    'before',
    selfCapacityMb,
    afterCandidate?.role
  );
  const validBefore =
    beforeCandidate && !beforeCandidate.attachedToAdjacentSpec
      ? beforeCandidate
      : undefined;
  const validAfter =
    afterCandidate && !afterCandidate.attachedToAdjacentSpec
      ? afterCandidate
      : undefined;

  if (!validBefore) return validAfter?.role;
  if (!validAfter) return validBefore.role;
  if (validAfter.followedByUnlabeledCapacity) return validBefore.role;
  return validAfter.distance <= validBefore.distance
    ? validAfter.role
    : validBefore.role;
}
