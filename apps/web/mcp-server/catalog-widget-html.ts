/** The conversation cart owns writes in credential mode. */
export function configureCatalogWidgetHtml(
  html: string,
  catalogOnly: boolean,
  legacyWidget = false
): string {
  const attributes = [
    ...(catalogOnly ? ['data-ogabassey-catalog-only="true"'] : []),
    ...(legacyWidget ? ['data-ogabassey-legacy-widget="true"'] : []),
  ];
  if (!attributes.length) return html;
  const tagged = html.replace(
    /<html(?=[\s>])/i,
    (root) => `${root} ${attributes.join(' ')}`
  );
  if (catalogOnly && tagged === html)
    throw new Error('Catalog-only widget requires a full HTML document');
  return tagged;
}
