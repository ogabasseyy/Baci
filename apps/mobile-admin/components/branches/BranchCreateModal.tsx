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
import { styles } from './BranchCreateModal.styles';

interface BranchCreateModalColors {
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

interface BranchCreateModalProps {
  visible: boolean;
  onClose: () => void;
  branchName: string;
  setBranchName: (name: string) => void;
  branchAddress: string;
  setBranchAddress: (address: string) => void;
  nameError: string;
  setNameError: (error: string) => void;
  onSubmit: () => void | Promise<void>;
  isLoading: boolean;
  colors: BranchCreateModalColors;
}

export function BranchCreateModal({
  visible,
  onClose,
  branchName,
  setBranchName,
  branchAddress,
  setBranchAddress,
  nameError,
  setNameError,
  onSubmit,
  isLoading,
  colors,
}: BranchCreateModalProps) {
  const branchAddressRef = useRef<TextInputInstance>(null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isLoading ? undefined : onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={onClose}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
          accessibilityState={{ disabled: isLoading }}
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
                Create Branch
              </Text>
              <Pressable
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                onPress={onClose}
                disabled={isLoading}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close create branch modal"
                accessibilityState={{ disabled: isLoading }}
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
                returnKeyType="next"
                blurOnSubmit={false}
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
                returnKeyType="done"
                onSubmitEditing={isLoading ? undefined : onSubmit}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelButton,
                  { backgroundColor: colors.background },
                  isLoading && styles.buttonDisabled,
                  pressed && !isLoading && { opacity: 0.7 },
                ]}
                onPress={onClose}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Cancel branch creation"
                accessibilityState={{ disabled: isLoading }}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  { backgroundColor: colors.primary },
                  isLoading && styles.buttonDisabled,
                  pressed && !isLoading && { opacity: 0.7 },
                ]}
                onPress={onSubmit}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel={
                  isLoading ? 'Creating branch' : 'Create branch'
                }
                accessibilityState={{ busy: isLoading, disabled: isLoading }}
              >
                {isLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.textOnPrimary}
                  />
                ) : (
                  <Text
                    style={[styles.buttonText, { color: colors.textOnPrimary }]}
                  >
                    Create Branch
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
