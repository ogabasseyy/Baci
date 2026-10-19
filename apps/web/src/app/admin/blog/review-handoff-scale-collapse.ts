const TRANSFORM_FUNCTION_PATTERN = /([a-z][a-z0-9]*)\(([^()]*)\)/g;

function parseTransformNumbers(
  args: string,
  allowPercent: boolean
): number[] | null {
  const tokens = args.split(/[\s,]+/).filter((token) => token !== '');
  const numbers: number[] = [];
  for (const token of tokens) {
    // Scale functions and the scale property accept percentages
    // (0% collapses like 0); matrix() takes unitless numbers only,
    // so a percentage there is an ignored declaration, not hiding.
    const text =
      allowPercent && token.endsWith('%') ? token.slice(0, -1) : token;
    if (text === '') return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    numbers.push(parsed);
  }
  return numbers;
}

function isZeroScaleFunction(name: string, args: number[]): boolean {
  switch (name) {
    case 'scale':
      return (
        (args.length === 1 && args[0] === 0) ||
        (args.length === 2 && (args[0] === 0 || args[1] === 0))
      );
    case 'scalex':
    case 'scaley':
      return args.length === 1 && args[0] === 0;
    case 'scale3d':
      return args.length === 3 && (args[0] === 0 || args[1] === 0);
    case 'matrix':
      return (
        args.length === 6 &&
        ((args[0] === 0 && args[1] === 0) || (args[2] === 0 && args[3] === 0))
      );
    case 'matrix3d': {
      if (args.length !== 16) {
        return false;
      }
      // Column-major: the X basis is (a1, a2, a3), the Y basis
      // (a5, a6, a7). A zero basis collapses that axis.
      const xCollapsed = args[0] === 0 && args[1] === 0 && args[2] === 0;
      const yCollapsed = args[4] === 0 && args[5] === 0 && args[6] === 0;
      return xCollapsed || yCollapsed;
    }
    default:
      return false;
  }
}

function isZeroScaleTransform(value: string): boolean {
  TRANSFORM_FUNCTION_PATTERN.lastIndex = 0;
  let match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  while (match !== null) {
    const name = match[1] ?? '';
    const args = parseTransformNumbers(
      match[2] ?? '',
      name.startsWith('scale')
    );
    if (args !== null && isZeroScaleFunction(name, args)) {
      return true;
    }
    match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  }
  return false;
}

function isZeroScaleProperty(value: string): boolean {
  const args = parseTransformNumbers(value, true);
  if (args === null || args.length < 1 || args.length > 3) {
    return false;
  }
  return args[0] === 0 || (args.length >= 2 && args[1] === 0);
}

/**
 * True when a transform list or scale property collapses the box to
 * zero area. Transform lists scan every function; the scale
 * property takes one to three numbers with percentages allowed.
 */
export function collapsesBoxToZero(
  value: string,
  kind: 'transform-list' | 'scale-property'
): boolean {
  return kind === 'transform-list'
    ? isZeroScaleTransform(value)
    : isZeroScaleProperty(value);
}
