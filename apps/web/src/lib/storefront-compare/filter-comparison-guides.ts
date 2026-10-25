const GENERIC = new Set([
  'apple',
  'samsung',
  'hp',
  'lg',
  'lenovo',
  'asus',
  'dell',
  'new',
  'used',
  'pro',
  'max',
  'inch',
  'laptop',
  'smart',
  'tv',
  'the',
  'and',
  'or',
]);
const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Fail sparse when model-specific buying advice has no relevant article. */
export function filterComparisonGuides<
  T extends { title: string; href: string },
>(links: T[], names: string[]): T[] {
  const models = names.map((name) => {
    const parts = tokens(name).filter((part) => !GENERIC.has(part));
    return {
      family: parts.find((part) => /[a-z]/.test(part)),
      generations: parts.filter(
        (part) => /\d/.test(part) && !/^\d{4}$/.test(part)
      ),
    };
  });
  return links.filter((link) => {
    const words = new Set(tokens(`${link.title} ${link.href}`));
    return models.some(
      (model) =>
        model.family &&
        words.has(model.family) &&
        (model.generations.length === 0 ||
          model.generations.some((part) => words.has(part)))
    );
  });
}
