export const PLATFORM_ID_BY_ALIAS: Readonly<Record<string, string>> =
  Object.freeze({
    ps5: 'ps5',
    'playstation 5': 'ps5',
    'ps5 pro': 'ps5',
    'playstation 5 pro': 'ps5',
    'ps5 slim': 'ps5',
    'playstation 5 slim': 'ps5',
    ps4: 'ps4',
    'playstation 4': 'ps4',
    'ps4 pro': 'ps4',
    'playstation 4 pro': 'ps4',
    'ps4 slim': 'ps4',
    'playstation 4 slim': 'ps4',
    ps3: 'ps3',
    'playstation 3': 'ps3',
    'ps vita': 'ps-vita',
    'playstation vita': 'ps-vita',
    xbox: 'xbox',
    'xbox 360': 'xbox-360',
    'xbox one': 'xbox-one',
    'xbox one x': 'xbox-one',
    'xbox one s': 'xbox-one',
    'xbox series x': 'xbox-series',
    'xbox series s': 'xbox-series',
    'xbox series': 'xbox-series',
    switch: 'switch',
    'nintendo switch': 'switch',
    'switch oled': 'switch',
    'nintendo switch oled': 'switch',
    'switch lite': 'switch',
    'nintendo switch lite': 'switch',
    'switch 2': 'switch-2',
    'nintendo switch 2': 'switch-2',
    'wii u': 'wii-u',
    'nintendo wii u': 'wii-u',
    wii: 'wii',
    'nintendo wii': 'wii',
    '3ds': '3ds',
    'nintendo 3ds': '3ds',
    pc: 'pc',
    windows: 'pc',
    steam: 'pc',
    'steam deck': 'pc',
  });

export function isRedundantPlatformListParenthetical(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .replace(
      /\b(xbox\s+)?series\s+[xs]\s*(?:[-/|]|\s*&\s*|\s+(?:and|or)\s+)\s*[xs]\b/gu,
      'xbox series x'
    )
    .replace(
      /\b(xbox\s+)?one\s+[xs]\s*(?:[-/|]|\s*&\s*|\s+(?:and|or)\s+)\s*[xs]\b/gu,
      'xbox one x'
    );
  const parts = normalized
    .split(
      /\s*(?:[,/&+;|]|\s*[-–—]\s*|\b(?:and|or)\b)(?:\s*(?:[,/&+;|]|\s*[-–—]\s*|\b(?:and|or)\b))*\s*/u
    )
    .map((part) => part.replace(/\s+/gu, ' ').trim());
  if (parts.length < 2 || parts.some((part) => !part)) return false;

  const rawIdentities = parts.map((part) =>
    Object.hasOwn(PLATFORM_ID_BY_ALIAS, part)
      ? PLATFORM_ID_BY_ALIAS[part]
      : null
  );
  if (rawIdentities.some((identity) => identity === null)) return false;

  const validIdentities = rawIdentities as string[];
  const specificXboxIdentities = new Set(
    validIdentities.filter((id) => id.startsWith('xbox-'))
  );
  const resolvedIdentities =
    specificXboxIdentities.size === 1
      ? validIdentities.map((id) =>
          id === 'xbox' ? [...specificXboxIdentities][0] : id
        )
      : validIdentities;

  return new Set(resolvedIdentities).size >= 2;
}

export function stripRedundantPlatformParentheticals(title: string): string {
  if (!title.includes('(') || !title.includes(')')) {
    return title;
  }

  let currentDepth = 0;
  let lastIndex = 0;
  let stripped = false;
  let strippedAtStart = false;
  let strippedAtEnd = false;
  let compacted = title.replace(
    /(?:\s*[-–—,:;|/&]+\s*|\s+\b(?:and|or)\b\s+|\s*)\(([^()]*)\)\s*(?=[,:;.!?]|$)|(?:\s*[-–—,:;|/&]+\s*|\s+\b(?:and|or)\b\s+|\s*)\(([^()]*)\)\s*(?=[-–—|/&]+\s+\S)|(?:\s*[-–—,:;|/&]+\s*|\s+\b(?:and|or)\b\s+|\s*)\(([^()]*)\)\s*(?=\(([^()]*)\))|(?:\s+\b(?:and|or)\b\s+|\s*&\s*|\s*)\(([^()]*)\)\s*/giu,
    (
      match,
      innerBeforePunctOrEnd?: string,
      innerBeforeSep?: string,
      innerBeforeNext?: string,
      innerNext?: string,
      innerOther?: string,
      offset?: number
    ) => {
      const parenOpenIndex = (offset ?? 0) + match.indexOf('(');
      for (let i = lastIndex; i < parenOpenIndex; i++) {
        if (title[i] === '(') {
          currentDepth++;
        } else if (title[i] === ')') {
          currentDepth = Math.max(0, currentDepth - 1);
        }
      }
      lastIndex = parenOpenIndex;

      if (currentDepth > 0) {
        return match;
      }

      const inner =
        innerBeforePunctOrEnd ??
        innerBeforeSep ??
        innerBeforeNext ??
        innerOther ??
        '';
      if (!isRedundantPlatformListParenthetical(inner)) {
        return match;
      }
      stripped = true;
      if (
        typeof offset === 'number' &&
        title.slice(0, offset).trim().length === 0
      ) {
        strippedAtStart = true;
      }
      if (typeof offset === 'number') {
        const remaining = title.slice(offset + match.length);
        if (
          remaining.trim().length === 0 ||
          /^(?:[\s\-–—|/&]|\b(?:and|or)\b)+$/iu.test(remaining)
        ) {
          strippedAtEnd = true;
        }
      }
      if (innerBeforePunctOrEnd !== undefined) {
        return '';
      }
      if (innerBeforeSep !== undefined) {
        return ' ';
      }
      if (innerBeforeNext !== undefined) {
        return isRedundantPlatformListParenthetical(innerNext ?? '') ? '' : ' ';
      }
      return ' ';
    }
  );

  if (!stripped) {
    return title;
  }

  if (strippedAtStart) {
    compacted = compacted.replace(
      /^\s*(?:[,:;.!?]\s*|[-–—|/&]\s+|\b(?:and|or)\s+)+/iu,
      ''
    );
  }

  if (strippedAtEnd) {
    compacted = compacted.replace(
      /(?:\s*[-–—,:;|/&]+|\s+\b(?:and|or)\b)\s*$/iu,
      ''
    );
  }

  return compacted.trim();
}
