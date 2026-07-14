interface BuildCategoryGraphicsHrefOptions {
  graphics: string[];
  pathname: string;
  resetPage?: boolean;
  search?: string;
}

export function buildCategoryGraphicsHref({
  graphics,
  pathname,
  resetPage = false,
  search = '',
}: BuildCategoryGraphicsHrefOptions): string {
  const searchParams = new URLSearchParams(search);
  searchParams.delete('graphics');
  graphics.forEach((value) => {
    searchParams.append('graphics', value);
  });

  if (resetPage) {
    searchParams.delete('page');
  }

  const query = searchParams.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
