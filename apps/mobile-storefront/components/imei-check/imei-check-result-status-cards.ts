import type { ImeiCheckField } from '@baci/shared/imei';
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { ImeiResult } from '@/lib/validation';
import type { ImeiCheckerColors } from './imei-check.types';

export interface ImeiResultStatusCard {
  cleanAware?: boolean;
  /** Read with the shared blacklist rules ("Not Blacklisted" is clean). */
  blacklist?: boolean;
  icon: IoniconsIconName;
  label: string;
  tint?: string;
  value: string;
}

export function getImeiResultStatusCards(
  result: ImeiResult,
  colors: ImeiCheckerColors,
  checksIncluded: readonly ImeiCheckField[]
): ImeiResultStatusCard[] {
  // The core status cards render "Unknown" when the provider omits them, so
  // they are gated on what the tier actually checks — a serial-info report
  // otherwise shows a wall of Unknown blacklist/iCloud/SIM/carrier cards it
  // never looked up. Optional cards stay value-gated: when the provider
  // returns bonus data the tier didn't promise, showing it is a feature.
  const included = new Set<ImeiCheckField>(checksIncluded);
  return [
    included.has('blacklistStatus')
      ? {
          blacklist: true,
          cleanAware: true,
          icon: 'shield-checkmark' as const,
          label: 'Blacklist Status',
          value: result.blacklistStatus,
        }
      : null,
    optionalStatusCard(result.activationStatus, {
      icon: 'sparkles',
      label: 'Activation Status',
      tint: colors.primary,
    }),
    optionalStatusCard(result.miLockStatus, {
      cleanAware: true,
      icon: 'lock-closed-outline',
      label: 'Mi Lock Status',
    }),
    optionalStatusCard(result.miLostStatus, {
      cleanAware: true,
      icon: 'shield-outline',
      label: 'Mi Lost Status',
    }),
    // Both iCloud cards ride on the 'icloud' check (icloudLock has no
    // separate ImeiCheckField).
    included.has('icloud')
      ? {
          cleanAware: true,
          icon: 'cloud-outline' as const,
          label: 'iCloud Status',
          value: result.icloud,
        }
      : null,
    included.has('icloud')
      ? {
          cleanAware: true,
          icon: 'lock-closed' as const,
          label: 'Find My iPhone',
          value: result.icloudLock,
        }
      : null,
    included.has('simLock')
      ? {
          icon: 'globe' as const,
          label: 'SIM Lock',
          tint: colors.primary,
          value: result.simLock,
        }
      : null,
    included.has('carrier')
      ? {
          icon: 'cellular' as const,
          label: 'Carrier',
          tint: colors.accent,
          value: result.carrier,
        }
      : null,
    optionalStatusCard(result.serialNumber, {
      icon: 'barcode-outline',
      label: 'Serial Number',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.purchaseDate, {
      icon: 'calendar-outline',
      label: 'Purchase Date',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.purchaseCountry, {
      icon: 'earth-outline',
      label: 'Purchase Country',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.warranty, {
      icon: 'shield-checkmark-outline',
      label: 'Warranty',
      tint: colors.success,
    }),
    optionalStatusCard(result.refurbished, {
      cleanAware: true,
      icon: 'refresh-outline',
      label: 'Refurbished',
    }),
    optionalStatusCard(result.demoUnit, {
      cleanAware: true,
      icon: 'phone-portrait-outline',
      label: 'Demo Unit',
    }),
    optionalStatusCard(result.mdmStatus, {
      cleanAware: true,
      icon: 'briefcase-outline',
      label: 'MDM Status',
    }),
    optionalStatusCard(result.knoxGuardStatus, {
      cleanAware: true,
      icon: 'lock-closed-outline',
      label: 'Knox Guard',
    }),
    optionalStatusCard(result.gsxCoverage, {
      // Neutral tint: gsxCoverage is raw Sickw text that can read
      // "Expired"/"Out of Coverage", so a fixed success green would mislead.
      icon: 'shield-checkmark-outline',
      label: 'Coverage',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.repairEligibility, {
      icon: 'build-outline',
      label: 'Repair Eligibility',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.repairHistory, {
      cleanAware: true,
      icon: 'construct-outline',
      label: 'Repair History',
    }),
    optionalStatusCard(result.replacementHistory, {
      cleanAware: true,
      icon: 'refresh-outline',
      label: 'Replacement History',
    }),
    optionalStatusCard(result.partNumber, {
      icon: 'pricetag-outline',
      label: 'Part Number',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.esimCompatibility, {
      icon: 'radio-outline',
      label: 'eSIM Compatibility',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.financeStatus, {
      cleanAware: true,
      icon: 'cash-outline',
      label: 'Finance Status',
    }),
    optionalStatusCard(result.knoxEnrollment, {
      cleanAware: true,
      icon: 'shield-checkmark-outline',
      label: 'Knox Enrollment',
    }),
    optionalStatusCard(result.soldBy, {
      icon: 'business-outline',
      label: 'Sold By',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.wifiMac, {
      icon: 'wifi-outline',
      label: 'Wi-Fi MAC',
      tint: colors.textSecondary,
    }),
    optionalStatusCard(result.devicePhoto, {
      icon: 'image-outline',
      label: 'Device Photo',
      tint: colors.textSecondary,
    }),
  ].filter((card): card is ImeiResultStatusCard => Boolean(card));
}

function optionalStatusCard(
  value: string | undefined,
  config: Omit<ImeiResultStatusCard, 'value'>
): ImeiResultStatusCard | null {
  return value ? { ...config, value } : null;
}
