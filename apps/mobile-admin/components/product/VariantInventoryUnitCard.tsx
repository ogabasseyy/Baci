import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type { VariantInventoryUnit } from '@/hooks/variantInventory';
import { getTranslucentColor } from '@/lib/colors/sanitize-css-color';
import type { Branch } from '@/schemas/branch';
import {
  badgeTextStyle,
  type InventoryStatus,
  inventoryStatuses,
  selectedBadgeStyle,
} from './VariantInventoryUnitCard.helpers';
import { variantInventoryUnitsSheetStyles as styles } from './VariantInventoryUnitsSheet.styles';

interface VariantInventoryUnitCardProps {
  assignment?: ReactNode;
  branches: Branch[];
  colors: ThemeColors;
  editBranchId: string | null;
  editNotes: string;
  editing: boolean;
  editStatus: InventoryStatus;
  onCancelEdit: () => void;
  onDelete: (unit: VariantInventoryUnit) => void;
  onEdit: (unit: VariantInventoryUnit) => void;
  onEditBranchChange: (branchId: string | null) => void;
  onEditNotesChange: (notes: string) => void;
  onEditStatusChange: (status: InventoryStatus) => void;
  onSaveEdit: (unit: VariantInventoryUnit) => void;
  unit: VariantInventoryUnit;
}

export function VariantInventoryUnitCard({
  assignment,
  branches,
  colors,
  editBranchId,
  editNotes,
  editing,
  editStatus,
  onCancelEdit,
  onDelete,
  onEdit,
  onEditBranchChange,
  onEditNotesChange,
  onEditStatusChange,
  onSaveEdit,
  unit,
}: VariantInventoryUnitCardProps) {
  const branchName =
    branches.find((branch) => branch.id === unit.branch_id)?.name ||
    'Central Stock';

  if (editing) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.primary },
        ]}
      >
        <Text style={[styles.identifier, { color: colors.text }]}>
          Editing {unit.identifier_value} ({unit.identifier_type.toUpperCase()})
        </Text>

        <View style={styles.formRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Status
          </Text>
          <View style={styles.badgeRow}>
            {inventoryStatuses.map((status) => {
              const isSelected = editStatus === status;
              return (
                <Pressable
                  accessibilityLabel={`Select status ${status}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={status}
                  onPress={() => onEditStatusChange(status)}
                  style={[
                    styles.badgeOption,
                    { borderColor: colors.border },
                    isSelected && selectedBadgeStyle(colors),
                  ]}
                >
                  <Text style={badgeTextStyle(colors, isSelected)}>
                    {status}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {branches.length > 0 ? (
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Branch
            </Text>
            <View style={styles.badgeRow}>
              <Pressable
                accessibilityLabel="Assign to Central Stock"
                accessibilityRole="radio"
                accessibilityState={{ checked: editBranchId === null }}
                onPress={() => onEditBranchChange(null)}
                style={[
                  styles.badgeOption,
                  { borderColor: colors.border },
                  editBranchId === null && selectedBadgeStyle(colors),
                ]}
              >
                <Text style={badgeTextStyle(colors, editBranchId === null)}>
                  Central
                </Text>
              </Pressable>
              {branches.map((branch) => {
                const isSelected = editBranchId === branch.id;
                return (
                  <Pressable
                    accessibilityLabel={`Assign to ${branch.name}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    key={branch.id}
                    onPress={() => onEditBranchChange(branch.id)}
                    style={[
                      styles.badgeOption,
                      { borderColor: colors.border },
                      isSelected && selectedBadgeStyle(colors),
                    ]}
                  >
                    <Text style={badgeTextStyle(colors, isSelected)}>
                      {branch.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.formRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Notes
          </Text>
          <TextInput
            accessibilityLabel="Unit notes input"
            onChangeText={onEditNotesChange}
            placeholder="Fulfillment or condition notes"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.editInput,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={editNotes}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Cancel editing unit"
            accessibilityRole="button"
            onPress={onCancelEdit}
            style={[
              styles.actionButton,
              { borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Save unit changes"
            accessibilityRole="button"
            onPress={() => onSaveEdit(unit)}
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.textOnPrimary, fontWeight: '600' }}>
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusColors: Record<InventoryStatus, string> = {
    available: colors.success,
    defective: colors.error,
    reserved: colors.primary,
    returned: colors.returned,
    sold: colors.textSecondary,
  };
  const statusColor = statusColors[unit.status];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.identifier, { color: colors.text }]}>
            {unit.identifier_value}
          </Text>
          <Text style={[styles.metadata, { color: colors.textSecondary }]}>
            {unit.identifier_type.toUpperCase()} • {branchName} • Source:{' '}
            {unit.source}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: getTranslucentColor(
                statusColor,
                'rgba(0,0,0,0.05)',
                0.08
              ),
            },
          ]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>
            {unit.status.toUpperCase()}
          </Text>
        </View>
      </View>

      {unit.notes ? (
        <Text style={[styles.notesText, { color: colors.textSecondary }]}>
          Notes: {unit.notes}
        </Text>
      ) : null}

      {assignment}

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Delete unit ${unit.identifier_value}`}
          accessibilityRole="button"
          onPress={() => onDelete(unit)}
          style={[
            styles.iconButton,
            { borderColor: colors.error, borderWidth: 1 },
          ]}
        >
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text
            style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}
          >
            Delete
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Edit unit ${unit.identifier_value}`}
          accessibilityRole="button"
          onPress={() => onEdit(unit)}
          style={[
            styles.iconButton,
            { borderColor: colors.primary, borderWidth: 1 },
          ]}
        >
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text
            style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}
          >
            Edit
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
