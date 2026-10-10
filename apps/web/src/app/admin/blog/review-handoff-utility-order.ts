// Natural ordering for Tailwind utilities within one cascade layer:
// maximal digit runs compare numerically, everything else by code
// unit. Verified against Tailwind v4.3.1 output (h-20 < h-100,
// text-red-50 < text-red-100/0, opacity-100 < opacity-[0],
// h-4 < h-[10px] < h-auto).
function isDigitChar(value: string): boolean {
  return value >= '0' && value <= '9';
}

export function compareNaturalOrder(a: string, b: string): number {
  let ia = 0;
  let ib = 0;
  while (ia < a.length && ib < b.length) {
    if (isDigitChar(a[ia]) && isDigitChar(b[ib])) {
      let ea = ia;
      while (ea < a.length && isDigitChar(a[ea])) ea += 1;
      let eb = ib;
      while (eb < b.length && isDigitChar(b[eb])) eb += 1;
      const na = a.slice(ia, ea).replace(/^0+/, '');
      const nb = b.slice(ib, eb).replace(/^0+/, '');
      if (na.length !== nb.length) return na.length - nb.length;
      if (na !== nb) return na < nb ? -1 : 1;
      ia = ea;
      ib = eb;
      continue;
    }
    if (a[ia] !== b[ib]) return a[ia] < b[ib] ? -1 : 1;
    ia += 1;
    ib += 1;
  }
  return a.length - b.length;
}
