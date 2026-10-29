const BUDGET_CUE =
  /\b(?:under|below|budget(?:\s+(?:of|is))?|within|less\s+than|up\s+to|at\s+most|maximum|max|between)(?=\s|[^\p{L}_]|$)/giu;
const AMOUNT =
  /^\s*(?:(₦|ngn\s*|n(?=\d))\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?(?:\s*(naira|ngn|₦))?(?![\p{L}\p{N}_]|[,.]\d)/iu;
const SYMBOL_CODES: Readonly<Record<string, string>> = {
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '₩': 'KRW',
};
const AMBIGUOUS_WORD_CODES = new Set(
  'ALL TOP TRY PEN MOP COP MAD BOB GEL SOS CUP BAM RUB'.split(' ')
);
type CurrencyToken = { length: number; code?: string; ambiguous?: boolean };
const CURRENCY_CODES = new Set(
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'.split(
    ' '
  )
);

/** Identify currency immediately attached to an amount, without converting it. */
function currencyToken(text: string): CurrencyToken | undefined {
  const symbol = /^\s*(\p{Sc})/u.exec(text);
  if (symbol) {
    if (symbol[1] === '₦') return undefined; // AMOUNT consumes naira.
    const code = SYMBOL_CODES[symbol[1]];
    return { length: symbol[0].length, code };
  }
  const word = /^\s*([A-Za-z]{3,})(?=\b|\d)/.exec(text);
  if (!word) return undefined;
  const raw = word[1];
  const code = raw.toUpperCase();
  if (
    raw !== 'ALL' &&
    code === 'ALL' &&
    /^\s+(?:brands?|models?)\b/i.test(text.slice(word[0].length))
  )
    return undefined;
  if (code === 'NGN') return undefined; // AMOUNT consumes naira.
  if (CURRENCY_CODES.has(code))
    return {
      length: word[0].length,
      code,
      ambiguous: raw !== code && AMBIGUOUS_WORD_CODES.has(code),
    };
  if (/^(?:dollars?|pounds?|euros?|yen|yuan|rupees?|kobo)$/i.test(raw))
    return { length: word[0].length };
  return undefined;
}

function hasAttachedAmbiguousCode(rawAmount: string | undefined): boolean {
  const suffix = rawAmount?.replace(/[,.]+$/, '').match(/[A-Za-z]+$/)?.[0];
  if (!suffix) return false;
  const withoutMultiplier = suffix.replace(/^(?:million|thousand|k|m)/i, '');
  return [suffix, withoutMultiplier].some(
    (word) =>
      word !== word.toUpperCase() &&
      AMBIGUOUS_WORD_CODES.has(word.toUpperCase())
  );
}

function isProductModelMax(text: string, index: number): boolean {
  // Only the immediately preceding words can identify a model name. A bounded
  // prefix avoids quadratic work on long inputs containing many Max tokens.
  const prefix = text.slice(Math.max(0, index - 128), index);
  if (
    /\b(?:phones?|smartphones?|iphones?|laptops?|macbooks?|tablets?|ipads?|earbuds?|headphones?|chargers?|accessor(?:y|ies)|products?|devices?)\s+(?:for|with)\s+[\p{L}\p{N}\s,'’-]{1,80}$/iu.test(
      prefix
    )
  )
    return false;
  const previousWord = prefix.match(/[\p{L}\p{N}-]+\s*$/u)?.[0].trim();
  return (
    !!previousWord &&
    !/^(?:a|an|the|my|your|our|with|at|for|of|is|be|have|has|need|want|max|limit|under|below|within|budget|price|cost|spend|phones?|smartphones?|laptops?|tablets?|earbuds?|headphones?|chargers?|accessor(?:y|ies)|products?|devices?)$/i.test(
      previousWord
    )
  );
}

/** Parse and remove only complete budget spans; unknown currencies fail closed. */
export function analyzeFastCatalogBudget(
  text: string,
  currencyCode?: string
): {
  price?: { amount: number; exclusive: boolean };
  searchText: string;
  hasBudget: boolean;
  invalid: boolean;
  ambiguousMax: boolean;
  ambiguousCurrency: boolean;
  unsupportedCurrency: boolean;
} {
  const spans: Array<{ start: number; end: number }> = [];
  let price: { amount: number; exclusive: boolean } | undefined;
  let hasBudget = false;
  let invalid = false;
  let ambiguousMax = false;
  let ambiguousCurrency = false;
  let unsupportedCurrency = false;

  for (const cue of text.matchAll(new RegExp(BUDGET_CUE.source, 'giu'))) {
    const start = cue.index;
    const tail = text.slice(start + cue[0].length);
    const prefixCurrency = currencyToken(tail);
    const amountTail = tail.slice(prefixCurrency?.length ?? 0);
    const amount = AMOUNT.exec(amountTail);
    const afterAmount = amount ? amountTail.slice(amount[0].length) : '';
    const suffixCurrency = amount ? currencyToken(afterAmount) : undefined;
    const malformedMultiplier = amount
      ? /^\s*(?:million|thousand)[\p{L}\p{N}_]+/iu.exec(afterAmount)
      : null;
    const rawAmount = !amount
      ? /^\s*(?:(?:₦|ngn\s*|n(?=\d))\s*)?[\d,.]+[\p{L}\p{N}_,.]*/iu.exec(
          amountTail
        )
      : null;
    const rawSuffixCurrency = rawAmount
      ? currencyToken(amountTail.slice(rawAmount[0].length))
      : undefined;
    const consumed =
      (prefixCurrency?.length ?? 0) +
      (amount?.[0].length ?? rawAmount?.[0].length ?? 0) +
      (suffixCurrency?.length ??
        malformedMultiplier?.[0].length ??
        rawSuffixCurrency?.length ??
        0);
    const modelMax = /^max\b/i.test(cue[0]) && isProductModelMax(text, start);
    if (modelMax) {
      if (
        amount &&
        (prefixCurrency ||
          suffixCurrency ||
          amount[1] ||
          amount[3] ||
          amount[4] ||
          Number(amount[2].replaceAll(',', '')) >= 1000)
      )
        ambiguousMax = true;
      continue;
    }
    hasBudget = true;
    // A later explicit budget supersedes an earlier invalid one, including
    // when the customer answers a clarification in a subsequent message.
    price = undefined;
    invalid = false;
    unsupportedCurrency = false;
    const mentionedCurrencies = [
      prefixCurrency,
      suffixCurrency,
      rawSuffixCurrency,
    ].filter((token): token is CurrencyToken => !!token);
    if (
      mentionedCurrencies.some((token) => token.ambiguous) ||
      hasAttachedAmbiguousCode(rawAmount?.[0])
    )
      ambiguousCurrency = true;
    if (amount && (amount[1] || amount[4]))
      mentionedCurrencies.push({ length: 0, code: 'NGN' });
    const storeCurrency = currencyCode?.toUpperCase();
    const wrongCurrency = mentionedCurrencies.some(
      (token) =>
        !token.code ||
        (storeCurrency ? token.code !== storeCurrency : token.code !== 'NGN')
    );
    if (wrongCurrency) unsupportedCurrency = true;
    if (
      /^between\b/i.test(cue[0]) ||
      !amount ||
      wrongCurrency ||
      malformedMultiplier
    ) {
      invalid = true;
      // Keep a range in the query so its lower bound cannot be discarded by a
      // later maximum. Other incomplete cues can be superseded by an answer.
      if (!/^between\b/i.test(cue[0]))
        spans.push({ start, end: start + cue[0].length + consumed });
      continue;
    }
    const value = Number(amount[2].replaceAll(',', ''));
    const multiplier = /^(?:m|million)$/i.test(amount[3] ?? '')
      ? 1_000_000
      : /^(?:k|thousand)$/i.test(amount[3] ?? '')
        ? 1_000
        : 1;
    const limit = value * multiplier;
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1_000_000_000_000) {
      invalid = true;
      spans.push({ start, end: start + cue[0].length + consumed });
      continue;
    }
    price = {
      amount: limit,
      exclusive: /^(?:under|below|less\s+than)$/i.test(cue[0]),
    };
    spans.push({ start, end: start + cue[0].length + consumed });
  }

  const fragments: string[] = [];
  let end = 0;
  for (const span of spans) {
    fragments.push(text.slice(end, span.start), ' ');
    end = span.end;
  }
  fragments.push(text.slice(end));
  return {
    price,
    searchText: fragments.join(''),
    hasBudget,
    invalid,
    ambiguousMax,
    ambiguousCurrency,
    unsupportedCurrency,
  };
}
