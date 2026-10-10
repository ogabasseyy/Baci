function parseClipNumber(token: string): {
  unit: string;
  value: number;
} | null {
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(%|[a-z]*)$/.exec(
    token.trim()
  );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { unit: match[2] ?? '', value };
}

function isZeroClipRadius(token: string): boolean {
  // circle() drops the <length> keywords closest-side/farthest-side
  // here: only an explicit zero radius clips everything.
  const parsed = parseClipNumber(token);
  return parsed !== null && parsed.value === 0;
}

function isZeroAreaCircleOrEllipse(name: string, args: string): boolean {
  const shape = args.split(/\s+at\s+/i)[0].trim();
  if (name === 'circle') {
    return shape !== '' && isZeroClipRadius(shape);
  }
  const radii = shape.split(/\s+/).filter((part) => part !== '');
  // Either zero radius collapses the ellipse to a line: zero area.
  return (
    radii.length === 2 &&
    radii.some((radius) => radius !== undefined && isZeroClipRadius(radius))
  );
}

function isZeroAreaInset(args: string): boolean {
  // Percentage insets wider than the box collapse it: only lengths
  // the box cannot outgrow prove hiding, so any non-percentage side
  // (px needs layout) keeps the content visible.
  const parts = args
    .split(/\s+round\s+/i)[0]
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  if (parts.length < 1 || parts.length > 4) return false;
  const [top = '', right = '', bottom = '', left = ''] =
    parts.length === 1
      ? [parts[0], parts[0], parts[0], parts[0]]
      : parts.length === 2
        ? [parts[0], parts[1], parts[0], parts[1]]
        : parts.length === 3
          ? [parts[0], parts[1], parts[2], parts[1]]
          : parts;
  const sides = [top, right, bottom, left].map((side) =>
    parseClipNumber(side ?? '')
  );
  // Unitless zero is 0 in every unit, percentages included; any other
  // non-percentage side needs layout and keeps the content visible.
  const percentages: number[] = [];
  for (const side of sides) {
    if (side === null) return false;
    if (side.unit === '%') {
      percentages.push(side.value);
    } else if (side.unit === '' && side.value === 0) {
      percentages.push(0);
    } else {
      return false;
    }
  }
  const [topPct = 0, rightPct = 0, bottomPct = 0, leftPct = 0] = percentages;
  return topPct + bottomPct >= 100 || leftPct + rightPct >= 100;
}

function isZeroAreaPolygon(args: string): boolean {
  // Identical vertices enclose nothing. Distinct vertices need a
  // layout-aware area proof the importer cannot make, so they stay
  // visible; a fill-rule keyword prefix is not a vertex.
  const points = args
    .split(',')
    .map((point) => point.trim().replace(/^(nonzero|evenodd)\s+/i, ''))
    .filter((point) => point !== '');
  return points.length >= 3 && points.every((point) => point === points[0]);
}

/**
 * Whether a clip-path value provably paints nothing. circle/ellipse
 * with a zero radius, percentage insets collapsing an axis, and
 * degenerate polygons hide the whole box including replaced content.
 * path()/url()/geometry-box values and px insets need layout and
 * stay visible.
 */
export function isZeroAreaClipPath(value: string): boolean {
  const match = /^([a-z][a-z0-9-]*)\((.*)\)$/i.exec(value.trim());
  if (!match) return false;
  const name = match[1].toLowerCase();
  const args = (match[2] ?? '').trim();
  if (args === '') return false;
  switch (name) {
    case 'circle':
    case 'ellipse':
      return isZeroAreaCircleOrEllipse(name, args);
    case 'inset':
      return isZeroAreaInset(args);
    case 'polygon':
      return isZeroAreaPolygon(args);
    default:
      return false;
  }
}
