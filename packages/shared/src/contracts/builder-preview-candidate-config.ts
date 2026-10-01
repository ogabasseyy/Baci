import { z } from 'zod';
import { type BuilderData, builderDataSchema } from './builder-ai-edit';
import { validateBuilderAiEditComplexity } from './builder-ai-edit/complexity-validator';
import { previewRenderPolicy } from './builder-preview-render-policy';
import { previewThemePolicy } from './builder-preview-theme-policy';

const candidateKeys = ['content', 'root', 'theme', 'zones'];
const sensitiveKeyPattern =
  /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const valueKeys = Object.keys(value);
  return (
    valueKeys.length === keys.length &&
    valueKeys.every((key) => keys.includes(key))
  );
}

function hasRoot(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['props']) &&
    isRecord(value.props) &&
    hasOnlyKeys(value.props, ['title']) &&
    typeof value.props.title === 'string' &&
    value.props.title.length <= 120
  );
}

function normalizePreviewRoot(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.root)) return value;
  const root = value.root;
  if (hasSensitiveField(root)) return value;

  const rootTitle =
    typeof root.title === 'string' && root.title.length <= 120
      ? root.title
      : root.title !== undefined
        ? undefined
        : isRecord(root.props) &&
            typeof root.props.title === 'string' &&
            root.props.title.length <= 120
          ? root.props.title
          : undefined;
  if (root.title !== undefined && rootTitle === undefined) return value;
  if (rootTitle !== undefined)
    return { ...value, root: { props: { title: rootTitle } } };

  if (
    hasOnlyKeys(root, []) ||
    (isRecord(root.props) && hasOnlyKeys(root.props, []))
  )
    return { ...value, root: { props: { title: 'Home' } } };

  return value;
}

function hasValidPuckCollections(value: unknown): boolean {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !candidateKeys.includes(key)) ||
    !Array.isArray(value.content) ||
    !hasRoot(value.root)
  )
    return false;
  if (
    value.theme !== undefined &&
    previewThemePolicy.getValidationError(value.theme) !== undefined
  )
    return false;
  const components = [...value.content];
  if (value.zones !== undefined) {
    if (!isRecord(value.zones)) return false;
    for (const collection of Object.values(value.zones)) {
      if (!Array.isArray(collection)) return false;
      components.push(...collection);
    }
  }
  const ids = new Map<string, string>();
  for (const component of components) {
    const identity = previewRenderPolicy.getPuckComponentIdentity(component);
    if (!identity || identity.type === 'Flex' || ids.has(identity.id))
      return false;
    ids.set(identity.id, identity.type);
  }
  if (value.zones === undefined) return true;
  return Object.keys(value.zones).every((zone) => {
    const parsed = previewRenderPolicy.parsePuckZoneKey(zone);
    const type = parsed ? ids.get(parsed.parentId) : undefined;
    return (
      parsed !== undefined &&
      type !== undefined &&
      previewRenderPolicy.allowsPuckZoneSlot(type, parsed.slot)
    );
  });
}

function hasSensitiveField(value: unknown): boolean {
  const visited = new WeakSet<object>();
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current))
      continue;
    visited.add(current);
    for (const [key, entry] of Object.entries(current)) {
      if (sensitiveKeyPattern.test(key)) return true;
      pending.push(entry);
    }
  }
  return false;
}

function getPreviewCandidateError(value: unknown): string {
  if (isRecord(value) && value.theme !== undefined) {
    const error = previewThemePolicy.getValidationError(value.theme);
    if (error !== undefined) return error;
  }
  return 'Expected a bounded render-safe Puck configuration';
}

function isPreviewCandidate(value: unknown): value is BuilderData {
  return (
    hasValidPuckCollections(value) &&
    builderDataSchema.safeParse(value).success &&
    validateBuilderAiEditComplexity(value).success &&
    !hasSensitiveField(value)
  );
}

export const builderPreviewCandidateConfigSchema = z.preprocess(
  normalizePreviewRoot,
  z
    .custom<BuilderData>(isPreviewCandidate, {
      error: (issue) => getPreviewCandidateError(issue.input),
    })
    .transform(previewRenderPolicy.projectPreviewCandidate)
);
