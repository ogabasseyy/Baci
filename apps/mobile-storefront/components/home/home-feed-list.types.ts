import type { StyleProp, ViewStyle } from 'react-native';
import type { ScrollHandlerProcessed } from 'react-native-reanimated';
import type { Block } from '@/types/blocks';
import type { Product } from '@/types/product';

export type HomeFeedListItem =
  | { kind: 'product'; product: Product }
  | { kind: 'product-list-end'; id: string };

export interface HomeFeedListProps {
  blocks: Block[];
  nextDrop?: boolean;
  primaryProductGridIndex: number;
  selectedCategoryId: string | null;
  onCategorySelect: (id: string | null) => void;
  onScroll: ScrollHandlerProcessed<Record<string, unknown>>;
  isSearchOpen: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  primaryColor: string;
  resolvedHeaderHeight: number;
  contentBottomPadding: number;
  blockWrapperStyle?: StyleProp<ViewStyle>;
}
