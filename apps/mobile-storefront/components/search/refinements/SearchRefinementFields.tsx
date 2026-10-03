import type { SearchRefinements } from '@baci/shared/lib';
import Ionicons from '@react-native-vector-icons/ionicons';
import { type ReactNode, type RefObject, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './search-refinement-styles';

interface Props {
  processors?: string[];
  focusGroup?: string;
  conditions?: NonNullable<SearchRefinements['condition']>[];
  brands: string[];
  categories: { id: string; name: string }[];
  draft: SearchRefinements;
  setDraft: (value: SearchRefinements) => void;
  minimum: string;
  maximum: string;
  setMinimum: (value: string) => void;
  setMaximum: (value: string) => void;
  brandQuery: string;
  setBrandQuery: (value: string) => void;
  setError: (value: string | null) => void;
  colors: (typeof Colors)['light'];
  positions: RefObject<Record<string, number>>;
  action: (
    label: string,
    onPress: () => void,
    selected?: boolean,
    role?: 'button' | 'checkbox' | 'radio',
    key?: string
  ) => ReactNode;
}
export function SearchRefinementFields({
  processors = [],
  focusGroup = 'price',
  conditions = ['new', 'used', 'open_box'],
  brands,
  categories,
  draft,
  setDraft,
  minimum,
  maximum,
  setMinimum,
  setMaximum,
  brandQuery,
  setBrandQuery,
  setError,
  colors,
  positions,
  action,
}: Props) {
  const [expanded, setExpanded] = useState(focusGroup);
  const labelStyle = { color: colors.text };
  const visibleBrands = [...new Set([...brands, ...draft.brands])].filter(
    (brand) => brand.toLowerCase().includes(brandQuery.toLowerCase())
  );
  const section = (key: string, title: string, children: ReactNode) => (
    <View
      key={key}
      onLayout={(event) => {
        positions.current[key] = event.nativeEvent.layout.y;
      }}
      style={{ gap: 8, paddingVertical: 4 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} options`}
        accessibilityState={{ expanded: expanded === key }}
        onPress={() => setExpanded(expanded === key ? '' : key)}
        style={{
          minHeight: 48,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: colors.muted,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
        <Ionicons
          name={expanded === key ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
      {expanded === key && children}
    </View>
  );
  return (
    <>
      <Text style={{ color: colors.textSecondary }}>
        Options for current results. Apply to update products.
      </Text>
      {(categories.length > 1 || !!draft.categoryId) &&
        section(
          'category',
          'Category',
          <View>
            {action(
              'All categories',
              () => setDraft({ ...draft, categoryId: undefined }),
              !draft.categoryId,
              'radio'
            )}
            {categories.map((category) =>
              action(
                category.name,
                () => setDraft({ ...draft, categoryId: category.id }),
                draft.categoryId === category.id,
                'radio'
              )
            )}
          </View>
        )}
      {section(
        'price',
        'Price',
        <View>
          <Text style={labelStyle}>Minimum price (₦)</Text>
          <TextInput
            accessibilityLabel="Minimum price (₦)"
            keyboardType="decimal-pad"
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={minimum}
            onChangeText={(value) => {
              setMinimum(value);
              setError(null);
            }}
          />
          <Text style={labelStyle}>Maximum price (₦)</Text>
          <TextInput
            accessibilityLabel="Maximum price (₦)"
            keyboardType="decimal-pad"
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={maximum}
            onChangeText={(value) => {
              setMaximum(value);
              setError(null);
            }}
          />
        </View>
      )}
      {section(
        'brand',
        'Brand',
        <View>
          {brands.length > 6 && (
            <TextInput
              accessibilityLabel="Search brands"
              placeholder="Search brands"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
              value={brandQuery}
              onChangeText={setBrandQuery}
            />
          )}
          {draft.brands.length > 0 && (
            <Text style={labelStyle}>
              Selected: {draft.brands.map((brand) => brand.trim()).join(', ')}
            </Text>
          )}
          {visibleBrands.map((brand) =>
            action(
              brand.trim(),
              () =>
                setDraft({
                  ...draft,
                  brands: draft.brands.includes(brand)
                    ? draft.brands.filter((b) => b !== brand)
                    : [...draft.brands, brand],
                }),
              draft.brands.includes(brand),
              'checkbox',
              brand
            )
          )}
          {!visibleBrands.length && (
            <Text style={labelStyle}>No brands match this text.</Text>
          )}
        </View>
      )}
      {(processors.length > 0 || !!draft.processor) &&
        section(
          'processor',
          'Processor',
          <View>
            {action(
              'Any processor',
              () => setDraft({ ...draft, processor: undefined }),
              !draft.processor,
              'radio'
            )}
            {[
              ...new Set([
                ...processors,
                ...(draft.processor ? [draft.processor] : []),
              ]),
            ].map((processor) =>
              action(
                processor,
                () => setDraft({ ...draft, processor }),
                draft.processor === processor,
                'radio'
              )
            )}
          </View>
        )}
      {section(
        'condition',
        'Condition',
        <View>
          {action(
            'Any condition',
            () => setDraft({ ...draft, condition: undefined }),
            !draft.condition,
            'radio'
          )}
          {conditions.map((value) =>
            action(
              value === 'open_box'
                ? 'Open Box'
                : value === 'new'
                  ? 'New'
                  : 'Used',
              () => setDraft({ ...draft, condition: value }),
              draft.condition === value,
              'radio'
            )
          )}
        </View>
      )}
    </>
  );
}
