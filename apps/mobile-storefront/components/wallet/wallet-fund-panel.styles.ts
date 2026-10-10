import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
    marginBottom: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  headerCopy: { flex: 1, gap: 5 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: { fontSize: 14, lineHeight: 22, marginBottom: 12 },
  accountName: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  accountBank: {
    fontSize: 12,
  },
  accountCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 18,
  },
  accountCopy: {
    flex: 1,
    gap: 6,
  },
  accountCopyButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountNumber: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardSubtitle: {
    marginTop: 16,
  },
  cardToggle: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  cardToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  copyFeedback: {
    fontSize: 12,
    marginTop: 6,
  },
  settingUpRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
});
