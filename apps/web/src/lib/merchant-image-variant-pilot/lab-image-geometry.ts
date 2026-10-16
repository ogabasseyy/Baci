// Recorded slot geometry for generic next/image lab mounts, from the
// pilot packet. The OgaBassey mobile hero reuses the production hero
// constants instead so its media/sizes match the mounted renderer
// exactly. Pure data module (no server-only): safe for any importer.
export interface PilotLabImageGeometry {
  sizes: string;
}

const LAB_IMAGE_GEOMETRY: Readonly<Record<string, PilotLabImageGeometry>> = {
  'header-logo': { sizes: '40px' },
  'product-card': { sizes: '50vw' },
};

export function labImageGeometry(slotId: string): PilotLabImageGeometry | null {
  return LAB_IMAGE_GEOMETRY[slotId] ?? null;
}
