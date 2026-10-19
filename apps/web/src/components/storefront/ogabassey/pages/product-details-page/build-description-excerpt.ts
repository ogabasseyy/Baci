const DESCRIPTION_EXCERPT_MAX_LENGTH = 200;

function truncateExcerpt(text: string): string {
  if (text.length <= DESCRIPTION_EXCERPT_MAX_LENGTH) {
    return text;
  }

  return `${text.substring(0, DESCRIPTION_EXCERPT_MAX_LENGTH)}...`;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

function isEnumCatalogLabel(label: string): boolean {
  return ['color', 'colour', 'condition', 'platform', 'connectivity'].includes(
    label.toLowerCase().trim()
  );
}

function isEnumCatalogValue(value: string): boolean {
  const trimmed = value.replace(/[.!?]+$/, '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  // Short enum-shaped phrases only (e.g. "space gray", "playstation 5", "dual sim").
  if (words.length === 0 || words.length > 4) {
    return false;
  }

  if (
    /\b(the|a|an|your|our|its|this|these|with|for|in|on|at|from|to|and|or)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }

  return words.every((word) =>
    /^(?:[a-z][a-z0-9_-]*|\d+[a-z0-9_-]*)$/i.test(word)
  );
}

function isSpecValue(value: string): boolean {
  const trimmed = value.replace(/[.!?]+$/, '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  const hasProseConnectors =
    /\b(the|a|an|your|our|its|this|these|every|each|all|with|for|in|on|at|from|to|into|through|across|without|and|or|so|than|as|you|we|it)\b/i.test(
      trimmed
    );

  // Values with spec list delimiters (e.g. "48MP Main | 12MP Ultra Wide" or "12MP + 12MP")
  if (/[|/+]/.test(trimmed) && /\d+\s*(?:mp|gb|tb|hz|w|mah|v)/i.test(trimmed)) {
    return true;
  }

  // Hardware measurement / technical token detection — evaluate before marketing prose.
  const hasHardwareTokens =
    /\b(?:\d+\s*(?:gb|tb|mb|ghz|mhz|mah|wh|w|v|mp|fps|hz|inch|inches|"|'|nm|core|cores|bit)|nvme|pcie|ssd|hdd|ddr\d*|lpddr\d*|amoled|oled|retina|ips|lcd|esim|nano-?sim|snapdragon|bionic|geforce|radeon|intel|ryzen|upgradable|onboard)\b/i.test(
      trimmed
    );

  if (hasHardwareTokens) {
    if (!hasProseConnectors || words.length <= 6) {
      return true;
    }
  }

  const hasCatalogValueSignal =
    /\b\d+\s*(?:gb|tb|mb|ghz|mhz|mah|wh|w|v|mp|fps|hz|inch|inches|"|'|nm|cores?)\b/i.test(
      trimmed
    ) ||
    /^(?:new|open\s+box|like\s+new|brand\s+new|refurbished|renewed|used|pre-?owned)$/i.test(
      trimmed
    ) ||
    /\([^)]*(?:upgradable|onboard|non-upgradable|nvme|pcie|ssd|ram)\b[^)]*\)/i.test(
      trimmed
    );

  if (hasCatalogValueSignal) {
    return true;
  }

  const hasMarketingProse =
    hasProseConnectors ||
    /\b(?:powerful|great|excellent|premium|stunning|beautiful|amazing|incredible|reliable|advanced|innovative|customizable|vivid|brilliant|expansive|capture|see|every|detail|built|designed|engineered|delivers|features|offers|experience|enjoy|perfect|ideal|superior|enhanced|smooth|fast|quick|long|all-day|workflows?|service|system|magic|life)\b/i.test(
      trimmed
    ) ||
    // Narrative phrasing after feature labels (e.g. "Capture life's magic.")
    (words.length >= 2 && /['’]/.test(trimmed));

  // Marketing must win over short title-case phrases like "Great Photos".
  if (hasMarketingProse) {
    return false;
  }

  // Short proper-noun catalog labels (brand, color) without marketing tone.
  if (
    words.length <= 3 &&
    words.every((word) => /^(?:[A-Z][\w-]*|[A-Z]{2,}|\d+[\w.-]*)$/.test(word))
  ) {
    return true;
  }

  return false;
}

function isSpecSentence(sentence: string): boolean {
  const trimmed = sentence.trim();

  // Pure metadata notice / disclaimer lines are always informational
  if (
    /^(?:availability\s*note|note|notes|disclaimer|disclaimers|notice|warranty\s*note):\s*/i.test(
      trimmed
    )
  ) {
    return true;
  }

  if (/^availability:\s*/i.test(trimmed)) {
    return true;
  }

  // Feature lines like "Storage: 2TB SSD" vs "Display: See every detail..."
  const knownLabelMatch = trimmed.match(
    /^(?:storage|ram|color|colour|condition|platform|display|battery|camera|processor|gpu|sim\s*type|connectivity|warranty):\s*(.+)$/i
  );
  if (knownLabelMatch) {
    const value = knownLabelMatch[1].trim();
    if (!value) return true;

    const label = knownLabelMatch[0].split(':')[0];
    if (isEnumCatalogLabel(label) && isEnumCatalogValue(value)) {
      return true;
    }

    return isSpecValue(value);
  }

  // Unmatched catalog labels such as Brand: Apple route through isSpecValue.
  const catalogLabelMatch = trimmed.match(/^([A-Za-z][\w\s-]*):\s*(.+)$/);
  if (catalogLabelMatch) {
    const value = catalogLabelMatch[2].trim();
    if (!value) return true;

    return isSpecValue(value);
  }

  return false;
}

function isProductTitleSentence(sentence: string): boolean {
  const trimmed = sentence.replace(/[.!?]+$/, '').trim();
  if (!trimmed) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  // Longer sentences are narrative prose, not bare catalog titles.
  if (words.length > 12) {
    return false;
  }

  // Sentence grammar or common narrative words — not a demonstrable product title.
  if (
    /\b(for|with|in|and|to|from|by|at|the|a|an|your|our|its|this|these|those|is|are|was|were|has|have|built|crafted|designed|engineered|delivers|features|provides|offers|experience|enjoy|capture|lasts|see|gives|lets|forged|featuring|every|when|where|because|there)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }

  // Promotional sentences that embed a model name are prose, not bare titles.
  if (
    /^(?:meet|discover|introducing|experience|explore|welcome|get|enjoy|upgrade|switch|choose|introducing)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }

  // Bare catalog model lines such as iPhone 15 Pro Max® or Dell XPS 16 9650.
  if (
    /^(?:[A-Za-z][\w&-]*\s+\d+[A-Za-z]?(?:\s+(?:Pro|Max|Plus|Ultra|Mini|Air|SE|XL|Lite|Edge|Note|Tab|Book|Pad|Watch|Buds|Series)\b)*)[®™©]?$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  const hasModelDigits =
    /\b\d{2,}\b/.test(trimmed) ||
    words.some((word) => /[A-Za-z]+\d+[A-Za-z]*/.test(word));
  const bareTitleTokenCount = words.filter((word) =>
    /^(?:[A-Z][\w-]*|[A-Z]{2,}|\d[\w.]*|[A-Z][A-Za-z]*\d+[A-Za-z]*|[®™©])$/.test(
      word
    )
  ).length;

  if (
    hasModelDigits &&
    bareTitleTokenCount === words.length &&
    words.length >= 2 &&
    words.length <= 8
  ) {
    return true;
  }

  return false;
}

function stripInlineHtml(html: string): string {
  return decodeBasicHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParagraphInnerHtml(
  html: string,
  pattern: RegExp
): string | null {
  const match = html.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  return stripInlineHtml(match[1]);
}

function filterProseText(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 && !isSpecSentence(s) && !isProductTitleSentence(s)
    );
  return sentences.join(' ');
}

export function buildDescriptionExcerpt(description: string) {
  if (!description) return '';

  const worthParagraphHtml = extractParagraphInnerHtml(
    description,
    /<h2[^>]*>Why[^<]*Worth[^<]*<\/h2>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i
  );

  if (worthParagraphHtml) {
    const benefitText = filterProseText(worthParagraphHtml);
    if (benefitText) {
      return truncateExcerpt(benefitText);
    }
  }

  const secondParagraphHtml = extractParagraphInnerHtml(
    description,
    /<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i
  );
  if (secondParagraphHtml) {
    const text = filterProseText(secondParagraphHtml);
    if (text) {
      return truncateExcerpt(text);
    }
  }

  const plainText = decodeBasicHtmlEntities(
    description.replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const allSentences = plainText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const nonSpecSentences = allSentences.filter((s) => !isSpecSentence(s));
  if (nonSpecSentences.length === 0) {
    return '';
  }

  const proseSentences = nonSpecSentences.filter(
    (s) => !isProductTitleSentence(s)
  );
  if (proseSentences.length === 0) {
    return '';
  }

  return truncateExcerpt(proseSentences.join(' '));
}
