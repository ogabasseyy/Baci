import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

const selectorBase: ViewStyle = {
  alignItems: 'center',
  borderRadius: RADIUS.md,
  borderWidth: 1,
  flexDirection: 'row',
  justifyContent: 'space-between',
  padding: SPACING.md,
};

const optionText: TextStyle = {
  fontFamily: TYPOGRAPHY.fontFamily.medium,
  fontSize: TYPOGRAPHY.size.md,
};

export const expenseFormStyles = StyleSheet.create({
  content: {
    padding: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
    marginBottom: SPACING.xs,
    marginLeft: 4,
  },
  amountContainer: {
    alignItems: 'center',
    borderBottomWidth: 2,
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
  },
  currencyPrefix: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size['3xl'],
    marginRight: SPACING.sm,
  },
  amountInput: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size['3xl'],
  },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: 100,
    padding: SPACING.md,
    textAlignVertical: 'top',
  },
  metadataInput: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  disabled: {
    opacity: 0.55,
  },
  selector: selectorBase,
  optionText,
  branchList: {
    gap: SPACING.sm,
  },
  branchOption: {
    ...selectorBase,
    minHeight: SPACING.touchTarget,
  },
  imageUpload: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    height: 200,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageUploadEmpty: {
    borderStyle: 'dashed',
  },
  uploadPlaceholder: {
    alignItems: 'center',
    gap: SPACING.sm,
  },
  uploadText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  receiptPreview: {
    height: '100%',
    width: '100%',
  },
  changeImageBadge: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    bottom: SPACING.md,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    position: 'absolute',
  },
  changeImageText: {
    fontSize: 12,
    fontWeight: '600',
  },
  receiptStatusText: {
    fontSize: TYPOGRAPHY.size.sm,
    marginTop: SPACING.sm,
  },
  receiptActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  receiptActionButton: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  receiptActionText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  receiptRemovalNotice: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
  },
  footer: {
    borderTopWidth: 1,
    padding: SPACING.lg,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    height: 56,
    justifyContent: 'center',
    padding: SPACING.md,
  },
  saveButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
  },
  sheetTitle: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
  },
  categoryOption: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.lg,
  },
  groupChoiceList: {
    gap: SPACING.sm,
  },
  groupOption: {
    ...selectorBase,
    minHeight: SPACING.touchTarget,
  },
  emptyGroupText: {
    fontSize: TYPOGRAPHY.size.sm,
    marginTop: SPACING.sm,
  },
  manageGroupsButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    marginTop: SPACING.md,
    minHeight: SPACING.touchTarget,
  },
  manageGroupsText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  createGroupRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  renameGroupRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  groupInput: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  createGroupButton: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minWidth: 84,
    paddingHorizontal: SPACING.md,
  },
  createGroupButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.md,
  },
  groupErrorText: {
    fontSize: TYPOGRAPHY.size.sm,
    marginBottom: SPACING.md,
  },
  groupList: {
    gap: SPACING.xs,
  },
  groupRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: SPACING.touchTarget,
    paddingVertical: SPACING.sm,
  },
  groupName: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
  },
  groupActions: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginLeft: SPACING.md,
  },
  archiveConfirmation: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: SPACING.lg,
    padding: SPACING.md,
  },
  confirmationTitle: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.md,
    marginBottom: SPACING.xs,
  },
  confirmationCopy: {
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: 18,
  },
  confirmationActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'flex-end',
    marginTop: SPACING.md,
  },
  cancelArchiveButton: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  cancelArchiveButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  confirmArchiveButton: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  confirmArchiveButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.sm,
  },
});
