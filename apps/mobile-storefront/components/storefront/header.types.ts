import type { RefObject } from 'react';

export interface HeaderProps {
  searchFocusTimer?: RefObject<ReturnType<typeof setTimeout> | undefined>;
  showSearch?: boolean;
  onSearchPress?: () => void;
  isSearchActive?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (text: string) => void;
  onSearchSubmit?: () => void;
  onSearchCancel?: () => void;
  isScrolled?: boolean;
  useWarmDarkSurface?: boolean;
  useScallopedSearch?: boolean;
}
