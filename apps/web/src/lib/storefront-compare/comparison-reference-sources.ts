// Primary references identified in the 2026-10-25 comparison audit. Linking a
// source does not certify that the mutable catalog has been reconciled to it.
const REFERENCES: Record<string, { title: string; href: string }> = {
  'macbook-pro-16-inch-m3-max-2023': {
    title: 'Apple: MacBook Pro 16-inch, November 2023',
    href: 'https://support.apple.com/en-us/117737',
  },
  'jbl-go-4': {
    title: 'JBL Go 4 manufacturer specification sheet',
    href: 'https://www.jbl.cl/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwec5ad861/pdfs/JBL%20Go%204_%20Specsheet_EN.pdf',
  },
  'airpods-4': {
    title: 'Apple AirPods 4 technical specifications',
    href: 'https://support.apple.com/en-us/121203',
  },
  'apple-airpods-4-anc': {
    title: 'Apple AirPods 4 with ANC technical specifications',
    href: 'https://support.apple.com/en-us/121204',
  },
  'steam-deck': {
    title: 'Valve: Steam Deck LCD and OLED specifications',
    href: 'https://www.steamdeck.com/en/tech/oled',
  },
  'steam-deck-oled': {
    title: 'Valve: Steam Deck LCD and OLED specifications',
    href: 'https://www.steamdeck.com/en/tech/oled',
  },
};
export function getComparisonReferenceSources(slugs: string[]) {
  return [
    ...new Map(
      slugs.flatMap((slug) =>
        REFERENCES[slug]
          ? [[REFERENCES[slug].href, REFERENCES[slug]] as const]
          : []
      )
    ).values(),
  ];
}
