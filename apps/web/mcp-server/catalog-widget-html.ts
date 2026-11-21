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
  return attributes.length
    ? html.replace(/<html(?=[\s>])/i, `<html ${attributes.join(' ')}`)
    : html;
}
