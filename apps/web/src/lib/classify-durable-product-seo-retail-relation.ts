export interface RetailRelation {
  cue: string;
  predicate: boolean;
  copula: boolean;
  identifierPredicate: boolean;
  commercial: boolean;
  separator: boolean;
  strong: boolean;
  purchase: boolean;
}

const COMMERCE_HEADING =
  /\b(?:(?:special|flash|clearance|limited[- ]time|today'?s|exclusive|hot|best|introductory|launch)\s+)?(?:sale|offer|deal|clearance)s?\s*[:–—-]\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i;
const POSSESSIVE_PRICE =
  /\b(?:has|had|have|with)\s+(?:an?\s+)?(?:retail\s+|listed\s+)?(?:prices?|costs?)\s+of\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i;

const PREPOSITIONAL_OR_SALE_QUALIFIER =
  /^\s*(?:[/]\s*|(?:per|each)\s+|(?:a|an)\s+(?:piece|unit|item|pack|copy|month|year|license|device)\b|(?:for|on|across|in|at|with|from)\b)/i;
const SPECIFICATION_UNIT =
  /^\s*(?:(?!(?:on|for|in|at|across|with|from|to|by|per|each|and|or)\b)[\p{L}-]+\s+){0,2}(?:units?|items?|pieces?|photos?|songs?|files?|people|users?|models?|colou?rs?|options?|sizes?|picks?|years?|days?|hours?|cycles?|washes|uses|pixels?|nits?|mah|kwh|wh|mwh|gb|tb|mb|hz|khz|mhz|ghz|mp|watts?|volts?|amps?|lumens?|lit(?:er|re)s?|degrees?|celsius|fahrenheit|inch(?:es)?|cm|mm|kg|g|grams?|oz|lbs?|pounds?)\b/iu;

export function retailRelation(text: string, start: number): RetailRelation {
  const clause =
    text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;\n]/)
      .at(-1) ?? '';
  const commerceHeading = COMMERCE_HEADING.test(clause);
  const possessivePrice = POSSESSIVE_PRICE.test(clause);
  const identifierUpdate =
    /\b(?:model\s+(?:number|no\.?|#)|sku|part\s+(?:number|no\.?|#)|serial(?:\s+(?:number|no\.?|#))?|imei|item\s+(?:number|no\.?|#)|product\s+code)(?:\s*:\s*|\s+)(?:was|were)\b/i.test(
      clause
    );
  const specificationUpdate =
    identifierUpdate ||
    /\b(?:rating|version|score|grade|revision|release|firmware|software|edition|year)\s*:?\s+(?:was|were)\b/i.test(
      clause
    );
  const followingText = text
    .slice(start)
    .replace(
      /^[\d,.]+\s*(?:,|;|\band\b)?\s*now\s*[:–—-]?\s*(?:[\p{Sc}\p{L}]{1,5}\s*)?[\d,.]+/u,
      ''
    );
  const immediateText = text.slice(start).replace(/^[\d,.]+/, '');
  const followingUnit =
    (!PREPOSITIONAL_OR_SALE_QUALIFIER.test(followingText) &&
      SPECIFICATION_UNIT.test(followingText)) ||
    (!PREPOSITIONAL_OR_SALE_QUALIFIER.test(immediateText) &&
      SPECIFICATION_UNIT.test(immediateText));
  const pairedSale =
    !specificationUpdate &&
    !followingUnit &&
    ((/\b(?:was|were)\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i.test(
      clause
    ) &&
      /^[\d,.]+\s*(?:,|;|\band\b)?\s*now\s*[:–—-]?\s*(?:[\p{Sc}\p{L}]{1,5}\s*)?[\d,.]+/iu.test(
        text.slice(start)
      )) ||
      /\b(?:was|were)\s+(?:[\p{Sc}\p{L}]{1,5}\s*)?[\d,.]+\s*(?:,|;|\band\b)?\s*now\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/iu.test(
        clause
      ));
  const cue =
    /\b(msrp(?:\s+(?:is|was|are|were))?|rrp(?:\s+(?:is|was|are|were))?|prices?(?:\s+range)?(?:\s+(?:is|from))?|costs?|priced\s+at|starts?\s+at|now\s+at|pay(?:\s+only)?|only|from|for|at)\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i.exec(
      clause
    )?.[1] ??
    (commerceHeading
      ? 'heading'
      : possessivePrice
        ? 'possessive'
        : pairedSale
          ? 'paired'
          : '');
  const predicate =
    possessivePrice ||
    /\b(?:prices?|costs?)(?:\s+(?:in|of|for)\s+(?:(?!(?:and|or|but|whose|which|that|where)\b)[\p{L}\p{N}'-]+\s*){1,8})?\s*(?:\b(?:is|was|are|were)\b|:)\s*$/iu.test(
      clause
    );
  const copula = /\b(?:is|was|are|were)\s*$/i.test(clause);
  const identifierPredicate =
    /\b(?:model\s+(?:number|no\.?)|sku|part\s+(?:number|no\.?)|serial(?:\s+(?:number|no\.?))?|imei|item\s+(?:number|no\.?)|product\s+code)(?:\s+(?:is|was|are|were)|\s*:)\s*$/i.test(
      clause
    );
  const commercial =
    /\b(?:sell(?:s|ing)?|sold|available|offered|retail(?:s|ed|ing)?)\b(?:\s+[^.!?;\n]{0,60})?\s+(?:at|for)\s*$/i.test(
      clause
    );
  return {
    cue,
    predicate,
    copula,
    identifierPredicate,
    commercial,
    separator: /^\s*[-:–—(|]?\s*$/.test(clause),
    strong:
      commerceHeading ||
      possessivePrice ||
      pairedSale ||
      /^(?:msrp|rrp|price|cost|priced|start|pay|only|now\s+at)/i.test(cue),
    purchase:
      /\b(?:buy|purchase)\b/i.test(clause) ||
      /\b(?:get(?!\s+(?:ready|prepared|started)\b)|shop)(?:\s+[^.!?;\n]{1,80})?\s+for\s*$/i.test(
        clause
      ),
  };
}
