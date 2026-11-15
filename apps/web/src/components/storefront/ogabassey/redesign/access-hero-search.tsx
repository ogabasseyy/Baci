import { ArrowUpRight, Search } from 'lucide-react';
import { STOREFRONT_SEARCH_MAX_QUERY_LENGTH } from '@/lib/storefront-search-params';
import { AccessSearchDock } from './access-search-dock';
import { AccessSearchStyles } from './access-search-styles';

export function AccessHeroSearch({
  basePath = '',
  reserve = false,
}: {
  basePath?: string;
  reserve?: boolean;
}) {
  if (reserve) {
    return (
      <>
        <AccessSearchStyles />
        <div className="oa-hero-search oa-hero-search-reserve" />
      </>
    );
  }

  return (
    <>
      <AccessSearchStyles />
      <AccessSearchDock>
      <search aria-label="Find your next device">
        <form
          className="oa-hero-search"
          aria-label="Device search"
          action={`${basePath}/search`}
          method="get"
        >
          <Search className="oa-search-icon" size={21} aria-hidden="true" />
          <input
            type="search"
            name="q"
            aria-label="Search smartphones, laptops and gadgets"
            placeholder="What’s your next device?"
            maxLength={STOREFRONT_SEARCH_MAX_QUERY_LENGTH}
            required
            title="Enter a device or brand to search for"
          />
          <button className="oa-search-submit" type="submit">
            Search <ArrowUpRight size={18} aria-hidden="true" />
          </button>
        </form>
      </search>
      </AccessSearchDock>
    </>
  );
}
