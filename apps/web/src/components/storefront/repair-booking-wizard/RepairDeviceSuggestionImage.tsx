'use client';

import type { RepairDeviceType } from '@baci/shared/repairs';
import Image from 'next/image';
import { useState } from 'react';
import {
  REPAIR_DEVICE_FALLBACK_ICON,
  REPAIR_DEVICE_TYPE_ICONS,
} from '../repairs/repair-device-icons';

export function RepairDeviceSuggestionImage({
  deviceType,
  imageUrl,
  label,
}: {
  deviceType: RepairDeviceType | null;
  imageUrl: string | null;
  label: string;
}) {
  const [hasLoadError, setHasLoadError] = useState(false);
  const Icon =
    (deviceType && REPAIR_DEVICE_TYPE_ICONS[deviceType]) ||
    REPAIR_DEVICE_FALLBACK_ICON;

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-store-secondary text-store-background-text/60">
      {imageUrl && !hasLoadError ? (
        <Image
          alt={label}
          className="size-12 object-contain"
          height={48}
          onError={() => setHasLoadError(true)}
          src={imageUrl}
          width={48}
        />
      ) : (
        <Icon aria-hidden="true" size={20} />
      )}
    </span>
  );
}
