function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeBuilderAiModelPlan(plan: unknown): unknown {
  if (!isRecord(plan) || !Array.isArray(plan.operations)) return plan;
  return {
    ...plan,
    operations: plan.operations.map((operation) => {
      if (
        !isRecord(operation) ||
        operation.kind !== 'insert_component' ||
        !isRecord(operation.initialContent)
      ) {
        return operation;
      }
      const { id: _ignoredModelId, ...initialContent } =
        operation.initialContent;
      return { ...operation, initialContent };
    }),
  };
}
