import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { AppPageSheet } from '@/components/ui/AppPageSheet';
import { SPACING, type ThemeColors } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useInventoryConditionOffers } from '@/hooks/useInventoryConditionOffers';
import {
  useAssignVariantInventoryOffer,
  useDeleteVariantInventoryUnit,
  useUpdateVariantInventoryUnit,
  useVariantInventory,
  type VariantInventoryStatus,
  type VariantInventoryUnit,
} from '@/hooks/variantInventory';
import { InventoryOfferAssignment } from './InventoryOfferAssignment';
import { CENTRAL_STOCK_BRANCH_ID } from './VariantInventory.constants';
import { VariantInventoryFiltersBar } from './VariantInventoryFiltersBar';
import { VariantInventoryUnitCard } from './VariantInventoryUnitCard';
import { variantInventoryUnitsSheetStyles as styles } from './VariantInventoryUnitsSheet.styles';

interface VariantInventoryUnitsSheetProps {
  colors: ThemeColors;
  productId: string;
  variantId?: string | null;
  onClose: () => void;
  visible?: boolean;
}

function toBranchScope(branchFilter: string | null) {
  if (branchFilter === CENTRAL_STOCK_BRANCH_ID) {
    return { branchId: null, branchScope: 'merchant_global' };
  }
  return {
    branchId: branchFilter,
    branchScope: branchFilter ? 'branch' : 'all',
  };
}

export function VariantInventoryUnitsSheet({
  colors,
  productId,
  variantId,
  onClose,
  visible = true,
}: VariantInventoryUnitsSheetProps) {
  const [statusFilter, setStatusFilter] =
    useState<VariantInventoryStatus | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editStatus, setEditStatus] =
    useState<VariantInventoryStatus>('available');
  const [editNotes, setEditNotes] = useState('');
  const [editBranchId, setEditBranchId] = useState<string | null>(null);

  const { data: branches = [] } = useBranches();
  const { branchId, branchScope } = toBranchScope(branchFilter);
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useVariantInventory({
    branchId,
    branchScope,
    limit: 20,
    productId,
    status: statusFilter,
    variantId: variantId || null,
  });

  const updateMutation = useUpdateVariantInventoryUnit();
  const deleteMutation = useDeleteVariantInventoryUnit();
  const assignMutation = useAssignVariantInventoryOffer();
  const offersQuery = useInventoryConditionOffers(productId, !variantId);
  const allUnits = data?.pages.flatMap((page) => page.units) || [];

  const handleAssignOffer = async (
    unit: VariantInventoryUnit,
    offerId: string | null
  ) => {
    try {
      await assignMutation.mutateAsync({ productId, unitId: unit.id, offerId });
    } catch (error) {
      Alert.alert(
        'Assignment Failed',
        error instanceof Error ? error.message : 'Could not assign condition.'
      );
    }
  };

  const handleEditPress = (unit: VariantInventoryUnit) => {
    setEditingUnitId(unit.id);
    setEditStatus(unit.status);
    setEditNotes(unit.notes || '');
    setEditBranchId(unit.branch_id);
  };

  const handleCancelEdit = () => {
    setEditingUnitId(null);
  };

  const handleSaveEdit = async (unit: VariantInventoryUnit) => {
    try {
      await updateMutation.mutateAsync({
        unitId: unit.id,
        productId: unit.product_id,
        status: editStatus,
        notes: editNotes.trim() || null,
        branchId: editBranchId,
        setBranch: true,
      });
      setEditingUnitId(null);
      Alert.alert('Success', 'Unit updated successfully.');
    } catch (error) {
      Alert.alert(
        'Update Failed',
        error instanceof Error ? error.message : 'Could not update unit.'
      );
    }
  };

  const handleDeletePress = (unit: VariantInventoryUnit) => {
    Alert.alert(
      'Delete Unit',
      `Are you sure you want to delete this unit (${unit.identifier_value})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({
                unitId: unit.id,
                productId: unit.product_id,
              });
              Alert.alert('Deleted', 'Unit deleted successfully.');
            } catch (error) {
              Alert.alert(
                'Delete Failed',
                error instanceof Error
                  ? error.message
                  : 'Could not delete unit.'
              );
            }
          },
        },
      ]
    );
  };

  return (
    <AppPageSheet
      title="Variant Inventory Units"
      visible={visible}
      onClose={onClose}
      scrollEnabled={false}
    >
      <VariantInventoryFiltersBar
        branchFilter={branchFilter}
        branches={branches}
        colors={colors}
        onBranchFilterChange={setBranchFilter}
        onStatusFilterChange={setStatusFilter}
        statusFilter={statusFilter}
      />

      {offersQuery.error ? (
        <Text style={[styles.emptyText, { color: colors.error }]}>
          Could not load condition offers.
        </Text>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.error }]}>
            Could not load inventory units.
          </Text>
          <Pressable
            accessibilityLabel="Retry loading inventory units"
            accessibilityRole="button"
            onPress={() => void refetch()}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryButtonText, { color: colors.primary }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : allUnits.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name="cube-outline"
            size={48}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No units found matching criteria.
          </Text>
        </View>
      ) : (
        <FlatList
          data={allUnits}
          renderItem={({ item }) => (
            <VariantInventoryUnitCard
              assignment={
                offersQuery.data?.length && item.is_inventory_anchor ? (
                  <InventoryOfferAssignment
                    colors={colors}
                    offers={offersQuery.data}
                    offerId={item.condition_offer_id ?? null}
                    disabled={
                      item.status !== 'available' || assignMutation.isPending
                    }
                    onAssign={(offerId) =>
                      void handleAssignOffer(item, offerId)
                    }
                  />
                ) : null
              }
              branches={branches}
              colors={colors}
              editBranchId={editBranchId}
              editing={editingUnitId === item.id}
              editNotes={editNotes}
              editStatus={editStatus}
              onCancelEdit={handleCancelEdit}
              onDelete={handleDeletePress}
              onEdit={handleEditPress}
              onEditBranchChange={setEditBranchId}
              onEditNotesChange={setEditNotes}
              onEditStatusChange={setEditStatus}
              onSaveEdit={handleSaveEdit}
              unit={item}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator
                color={colors.primary}
                size="small"
                style={{ marginVertical: SPACING.md }}
              />
            ) : undefined
          }
        />
      )}
    </AppPageSheet>
  );
}
