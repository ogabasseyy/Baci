export function words(value: string): string[] {
  return value.normalize('NFKC').replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    // Keep decimal specifications together (15.6-inch, 2.4G) so their
    // fractional part cannot be mistaken for a separate model/spec number.
    .toLocaleLowerCase('en').match(/[a-z0-9]+(?:\.[0-9]+[a-z0-9]*)?/g) ?? [];
}
