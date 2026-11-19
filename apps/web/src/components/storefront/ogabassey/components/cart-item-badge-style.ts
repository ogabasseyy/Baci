/**
 * Resolves theme-independent swatch colors for a cart line item's selected
 * colour variant, giving chromatic names priority over dark/metallic modifiers.
 */
export function resolveCartColorChipStyle(
  name: string,
  explicitValue?: string
): { backgroundColor: string; color: string; borderColor: string } {
  const trimmed = explicitValue?.trim();
  if (trimmed && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    const hex =
      trimmed.length === 4
        ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
        : trimmed;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return {
      backgroundColor: hex,
      color: luminance > 0.6 ? '#1f2937' : '#ffffff',
      borderColor: luminance > 0.85 ? '#d4d4d8' : hex,
    };
  }

  const lower = name.toLowerCase();
  const hasChromaticWord =
    /\b(green|blue|purple|violet|lavender|pink|rose|red|coral|orange|yellow|gold|desert|teal|mint)\b/.test(
      lower
    );

  if (
    lower.includes('black') ||
    lower.includes('obsidian') ||
    (!hasChromaticWord &&
      (lower.includes('midnight') || lower.includes('graphite')))
  ) {
    return {
      backgroundColor: '#1f2937',
      color: '#ffffff',
      borderColor: '#111827',
    };
  }
  if (
    lower.includes('white') ||
    lower.includes('starlight') ||
    lower.includes('porcelain')
  ) {
    return {
      backgroundColor: '#ffffff',
      color: '#3f3f46',
      borderColor: '#d4d4d8',
    };
  }
  if (lower.includes('silver') || lower.includes('platinum')) {
    return {
      backgroundColor: '#e4e4e7',
      color: '#27272a',
      borderColor: '#cbd5e1',
    };
  }
  if (lower.includes('orange')) {
    return {
      backgroundColor: '#ffedd5',
      color: '#9a3412',
      borderColor: '#fdba74',
    };
  }
  if (lower.includes('yellow')) {
    return {
      backgroundColor: '#fef08a',
      color: '#854d0e',
      borderColor: '#facc15',
    };
  }
  if (lower.includes('pink') || lower.includes('rose')) {
    return {
      backgroundColor: '#fce7f3',
      color: '#9d174d',
      borderColor: '#f9a8d4',
    };
  }
  if (lower.includes('gold') || lower.includes('desert')) {
    return {
      backgroundColor: '#fde68a',
      color: '#78350f',
      borderColor: '#f59e0b',
    };
  }
  if (
    lower.includes('blue') ||
    lower.includes('pacific') ||
    lower.includes('ultramarine') ||
    lower.includes('navy')
  ) {
    return {
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      borderColor: '#93c5fd',
    };
  }
  if (
    lower.includes('purple') ||
    lower.includes('violet') ||
    lower.includes('lavender')
  ) {
    return {
      backgroundColor: '#f3e8ff',
      color: '#6b21a8',
      borderColor: '#d8b4fe',
    };
  }
  if (
    lower.includes('green') ||
    lower.includes('mint') ||
    lower.includes('teal')
  ) {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      borderColor: '#86efac',
    };
  }
  if (lower.includes('red') || lower.includes('coral')) {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      borderColor: '#fca5a5',
    };
  }
  if (
    lower.includes('natural') ||
    lower.includes('titanium') ||
    lower.includes('grey') ||
    lower.includes('gray')
  ) {
    return {
      backgroundColor: '#e5e7eb',
      color: '#1f2937',
      borderColor: '#9ca3af',
    };
  }

  return {
    backgroundColor: '#e4e4e7',
    color: '#27272a',
    borderColor: '#cbd5e1',
  };
}
