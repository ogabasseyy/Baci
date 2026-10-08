import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SearchShoppingActions } from './SearchShoppingActions';

interface SearchScreenTopBarProps {
  colors: (typeof Colors)['light'];
  onBack: () => void;
  showComparison: boolean;
}

export function SearchScreenTopBar({
  colors,
  onBack,
  showComparison,
}: SearchScreenTopBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={{
          minHeight: 48,
          minWidth: 48,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <SearchShoppingActions
          colors={colors}
          showComparison={showComparison}
        />
      </View>
    </View>
  );
}
