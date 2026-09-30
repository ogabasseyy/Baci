import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { searchDropdownStyles as styles } from './SearchDropdown.styles';

type ThemeColors = (typeof Colors)['light'];

interface SeeAllResultsButtonProps {
  colors: ThemeColors;
  currentQuery: string;
  onSeeAllResults: (query: string) => void;
}

export function SeeAllResultsButton({
  colors,
  currentQuery,
  onSeeAllResults,
}: SeeAllResultsButtonProps) {
  const trimmedQuery = currentQuery.trim();
  return (
    <Pressable
      style={[styles.seeAllButton, { borderColor: colors.border }]}
      onPress={() => onSeeAllResults(currentQuery)}
      accessibilityLabel={`See all results for ${trimmedQuery}`}
      accessibilityRole="button"
    >
      <Ionicons name="search" size={16} color={BRAND.primary} />
      <Text
        style={[styles.seeAllText, { color: BRAND.primary }]}
        numberOfLines={1}
      >
        See all results for “{trimmedQuery}”
      </Text>
      <Ionicons name="arrow-forward-outline" size={14} color={BRAND.primary} />
    </Pressable>
  );
}
