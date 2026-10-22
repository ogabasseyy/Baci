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

export function retailRelation(text: string, start: number): RetailRelation {
  const clause =
    text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;\n]/)
      .at(-1) ?? '';
  const commerceHeading = COMMERCE_HEADING.test(clause);
  const cue =
    /\b(msrp(?:\s+(?:is|was|are|were))?|rrp(?:\s+(?:is|was|are|were))?|prices?(?:\s+(?:is|from))?|costs?|priced\s+at|starts?\s+at|now\s+at|pay(?:\s+only)?|only|from|for|at)\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i.exec(
      clause
    )?.[1] ?? (commerceHeading ? 'heading' : '');
  const predicate =
    /\b(?:prices?|costs?)(?:\s+(?:in|of|for)\s+(?:(?!(?:and|or|but|whose|which|that|where)\b)[\p{L}\p{N}'-]+\s*){1,8})?\s*(?:\b(?:is|was|are|were)\b|:)\s*$/iu.test(
      clause
    );
  const copula = /\b(?:is|was|are|were)\s*$/i.test(clause);
  const identifierPredicate =
    /\b(?:model\s+(?:number|no\.?)|sku|part\s+(?:number|no\.?)|serial(?:\s+(?:number|no\.?))?|imei|item\s+(?:number|no\.?)|product\s+code)\s+(?:is|was|are|were|:)\s*$/i.test(
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
      /^(?:msrp|rrp|price|cost|priced|start|pay|only|now\s+at)/i.test(cue),
    purchase:
      /\b(?:buy|purchase)\b/i.test(clause) ||
      /\b(?:get(?!\s+(?:ready|prepared|started)\b)|shop)(?:\s+[^.!?;\n]{1,80})?\s+for\s*$/i.test(
        clause
      ),
  };
}
