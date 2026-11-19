import { dedupeById } from '@baci/shared';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { NewOrderController } from '@/hooks/useNewOrderController';
import {
  getCustomerDisplayContact,
  getCustomerDisplayInitial,
  getCustomerDisplayName,
  MODAL_FLATLIST_PROPS,
} from './new-order.shared';
import { styles } from './new-order.styles';

interface NewOrderCustomerSearchViewProps {
  controller: NewOrderController;
  listBottomPadding?: number;
  showInlineSearch?: boolean;
}

const CUSTOMER_LIST_MIN_VIEWPORT_HEIGHT = 260;
const CUSTOMER_LIST_CHROME_OFFSET = 84;

export function NewOrderCustomerSearchView({
  controller,
  listBottomPadding = 40,
  showInlineSearch = true,
}: NewOrderCustomerSearchViewProps) {
  const [bodyHeight, setBodyHeight] = useState(0);
  const {
    colors,
    customerSearch,
    customersData,
    customersQuery,
    handleSelectCustomer,
    setCustomerSearch,
    setIsCreatingCustomer,
  } = controller;
  // The customers query requests server-side `sortBy: 'alpha'`, so pages already
  // arrive globally ordered by name. Preserve that order, but remove duplicate
  // ids if offset pagination shifts between page loads.
  const customerRows = dedupeById(
    customersData?.pages.flatMap((page) => page.customers) ?? []
  );
  const listViewportHeight = Math.max(
    CUSTOMER_LIST_MIN_VIEWPORT_HEIGHT,
    Math.round(bodyHeight) - CUSTOMER_LIST_CHROME_OFFSET
  );
  const emptyMessage = customersQuery.isLoading
    ? 'Loading customers...'
    : customersQuery.isError
      ? 'Failed to load customers'
      : 'No customers found';

  useEffect(() => {
    if (customersQuery.isError) {
      console.error('Customer search failed:', customersQuery.error);
    }
  }, [customersQuery.isError, customersQuery.error]);
  const canFetchMoreCustomers =
    customersQuery.hasNextPage &&
    !customersQuery.isFetchingNextPage &&
    !customersQuery.isLoading;

  return (
    <View
      onLayout={(event) => {
        setBodyHeight(event.nativeEvent.layout.height);
      }}
      style={styles.customerSearchBody}
    >
      {showInlineSearch ? (
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons color={colors.textMuted} name="search" size={20} />
          <TextInput
            onChangeText={setCustomerSearch}
            placeholder="Search name, email, or phone..."
            placeholderTextColor={colors.textMuted}
            style={{ color: colors.text, flex: 1, marginLeft: 8 }}
            value={customerSearch}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="Create new customer"
        accessibilityRole="button"
        onPress={() => setIsCreatingCustomer(true)}
        style={[
          styles.listRow,
          { borderBottomColor: colors.border, borderBottomWidth: 1 },
        ]}
      >
        <View
          style={[styles.iconBox, { backgroundColor: `${colors.primary}20` }]}
        >
          <Ionicons color={colors.primary} name="person-add" size={18} />
        </View>
        <Text
          style={[styles.listLabel, { color: colors.primary, fontSize: 16 }]}
        >
          Create new customer
        </Text>
      </Pressable>

      {/*
        Dedicated height-bounded wrapper with NO flex on the list itself. The
        bound must be shorter than the full content so Gorhom keeps a real
        scrollable viewport, but tall enough to fill the drawer above the
        floating search footer.
      */}
      <View
        style={{ flexShrink: 1, height: listViewportHeight }}
        testID="customer-list-viewport"
      >
        <BottomSheetFlatList
          // Explicit getItemLayout avoids asynchronous measurement cycles on the UI thread.
          getItemLayout={(_data, index) => ({
            length: 72,
            offset: 72 * index,
            index,
          })}
          {...MODAL_FLATLIST_PROPS}
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          data={customerRows}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 32 }}>
              <Text style={{ color: colors.textMuted }}>{emptyMessage}</Text>
            </View>
          }
          ListFooterComponent={
            customersQuery.isFetchingNextPage ? (
              <View style={{ padding: 16 }}>
                <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
                  Loading more customers…
                </Text>
              </View>
            ) : undefined
          }
          onEndReached={() => {
            if (!canFetchMoreCustomers) {
              return;
            }

            void customersQuery.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`Select customer ${getCustomerDisplayName(item)}`}
              accessibilityRole="button"
              onPress={() => handleSelectCustomer(item)}
              style={[
                styles.listRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: 1,
                  paddingVertical: 12,
                  height: 72,
                },
              ]}
            >
              <View
                style={[styles.iconBox, { backgroundColor: colors.cardHover }]}
              >
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                >
                  {getCustomerDisplayInitial(item)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={[styles.itemTitle, { color: colors.text }]}
                >
                  {getCustomerDisplayName(item)}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.textSecondary, fontSize: 13 }}
                >
                  {getCustomerDisplayContact(item)}
                </Text>
              </View>
              {item.total_orders > 0 ? (
                <View
                  style={[
                    styles.qtyBadge,
                    { backgroundColor: `${colors.success}20` },
                  ]}
                >
                  <Text style={{ color: colors.success, fontSize: 12 }}>
                    {item.total_orders} orders
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}
