import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareModalContainer } from '@/components/ui/KeyboardAwareModalContainer';
import { styles } from './BranchEditModal.styles';

interface BranchEditModalColors {
  background: string;
  border: string;
  card: string;
  notification: string;
  primary: string;
  text: string;
  textMuted: string;
  textOnPrimary: string;
  textSecondary: string;
}

interface BranchEditModalProps {
  visible: boolean;
  onClose: () => void;
  branchName: string;
  setBranchName: (name: string) => void;
  branchAddress: string;
  setBranchAddress: (address: string) => void;
  nameError: string;
  setNameError: (error: string) => void;
  onSubmit: () => void | Promise<void>;
  onDeactivate: () => void | Promise<void>;
  isUpdating: boolean;
  isDeactivating: boolean;
  canDeactivate: boolean;
  colors: BranchEditModalColors;
}

export function BranchEditModal({
  visible,
  onClose,
  branchName,
  setBranchName,
  branchAddress,
  setBranchAddress,
  nameError,
  setNameError,
  onSubmit,
  onDeactivate,
  isUpdating,
  isDeactivating,
  canDeactivate,
  colors,
}: BranchEditModalProps) {
  const branchAddressRef = useRef<TextInputInstance>(null);
  const isBusy = isUpdating || isDeactivating;
  const isDeactivateDisabled = isBusy || !canDeactivate;
  const handleClose = isBusy ? undefined : onClose;
  const handleSubmit = () => {
    if (!isBusy) {
      onSubmit();
    }
  };
  const handleDeactivate = () => {
    if (!isBusy && canDeactivate) {
      onDeactivate();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={handleClose}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
          accessibilityState={{ disabled: isBusy }}
        />
        <KeyboardAwareModalContainer
          align="center"
          contentContainerStyle={styles.modalKeyboardContent}
        >
          <View
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            accessibilityViewIsModal={true}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Edit Branch
              </Text>
              <Pressable
                style={({ pressed }) => [
                  pressed && !isBusy && { opacity: 0.7 },
                ]}
                onPress={handleClose}
                disabled={isBusy}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close edit modal"
                accessibilityState={{ disabled: isBusy }}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <Text
                style={[styles.inputLabel, { color: colors.textSecondary }]}
              >
                Branch Name *
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: nameError
                      ? colors.notification
                      : colors.border,
                  },
                ]}
                value={branchName}
                onChangeText={(text) => {
                  setBranchName(text);
                  setNameError('');
                }}
                placeholder="e.g. Lagos Main, Lekki Branch"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Branch name input"
                editable={!isBusy}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => branchAddressRef.current?.focus()}
              />
              {nameError ? (
                <Text
                  style={[styles.errorText, { color: colors.notification }]}
                >
                  {nameError}
                </Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <Text
                style={[styles.inputLabel, { color: colors.textSecondary }]}
              >
                Address (Optional)
              </Text>
              <TextInput
                ref={branchAddressRef}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                value={branchAddress}
                onChangeText={setBranchAddress}
                placeholder="e.g. 123 Main Street, Lekki"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Branch address input"
                editable={!isBusy}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.deactivateButton,
                  { borderColor: colors.notification },
                  isDeactivateDisabled && styles.buttonDisabled,
                  pressed && !isDeactivateDisabled && { opacity: 0.7 },
                ]}
                onPress={handleDeactivate}
                disabled={isDeactivateDisabled}
                accessibilityRole="button"
                accessibilityLabel="Deactivate branch"
                accessibilityState={{ disabled: isDeactivateDisabled }}
                accessibilityHint={
                  canDeactivate
                    ? 'Double tap to deactivate this branch'
                    : 'Create another branch before deactivating this one'
                }
              >
                {isDeactivating ? (
                  <ActivityIndicator size="small" color={colors.notification} />
                ) : (
                  <Text
                    style={[
                      styles.deactivateButtonText,
                      { color: colors.notification },
                    ]}
                  >
                    Deactivate
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: colors.primary },
                  isBusy && styles.buttonDisabled,
                  pressed && !isBusy && { opacity: 0.7 },
                ]}
                onPress={handleSubmit}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={
                  isUpdating ? 'Saving branch' : 'Save branch'
                }
                accessibilityState={{ disabled: isBusy }}
              >
                {isUpdating ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.textOnPrimary}
                  />
                ) : (
                  <Text
                    style={[
                      styles.saveButtonText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAwareModalContainer>
      </View>
    </Modal>
  );
}
