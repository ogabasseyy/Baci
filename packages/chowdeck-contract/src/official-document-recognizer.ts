import type { ChowdeckEvidenceClaimV1 } from './evidence-schema';

type Capability = ChowdeckEvidenceClaimV1['capability'];
type EvidenceField = ChowdeckEvidenceClaimV1['requestFields'][number];
type Operation = Extract<
  ChowdeckEvidenceClaimV1['operation'],
  { status: 'documented' }
>;

type OperationRule = {
  method: Operation['method'];
  pathTemplate: Operation['pathTemplate'];
  requestFields: EvidenceField[];
};

const CREATE_CATEGORY_FIELDS: EvidenceField[] = [
  { name: 'name', type: 'string', required: true },
  { name: 'reference', type: 'string', required: true },
];
const CREATE_ITEM_FIELDS: EvidenceField[] = [
  { name: 'description', type: 'string', required: false },
  { name: 'images', type: 'array', required: false },
  { name: 'in_stock', type: 'boolean', required: true },
  { name: 'menu_category_id', type: 'integer', required: true },
  { name: 'name', type: 'string', required: true },
  { name: 'path', type: 'string', required: true },
  { name: 'price', type: 'integer', required: true },
  { name: 'reference', type: 'string', required: true },
];

const OPERATION_RULES: Partial<Record<Capability, OperationRule>> = {
  'account.read': {
    method: 'get',
    pathTemplate: '/merchant/',
    requestFields: [],
  },
  'menu.category.create': {
    method: 'post',
    pathTemplate: '/merchant/{merchantReference}/menucategory',
    requestFields: CREATE_CATEGORY_FIELDS,
  },
  'menu.category.list': {
    method: 'get',
    pathTemplate: '/merchant/{merchantReference}/menucategory',
    requestFields: [],
  },
  'menu.item.create': {
    method: 'post',
    pathTemplate: '/merchant/{merchantReference}/menu',
    requestFields: CREATE_ITEM_FIELDS,
  },
  'menu.item.list': {
    method: 'get',
    pathTemplate: '/merchant/{merchantReference}/menu',
    requestFields: [],
  },
  'menu.item.read': {
    method: 'get',
    pathTemplate: '/merchant/{merchantReference}/menu/{menuReference}',
    requestFields: [],
  },
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function own(value: unknown, key: string): unknown {
  const candidate = record(value);
  return candidate !== undefined && Object.hasOwn(candidate, key)
    ? candidate[key]
    : undefined;
}

function requestShapeMatches(
  operation: unknown,
  expectedFields: EvidenceField[]
): boolean {
  if (record(operation) === undefined) return false;
  const requestBody = own(operation, 'requestBody');
  if (requestBody === undefined) return expectedFields.length === 0;
  const content = own(requestBody, 'content');
  const media = own(content, 'application/json');
  const schema = own(media, 'schema');
  const properties = record(own(schema, 'properties'));
  const requiredValue = own(schema, 'required');
  if (properties === undefined || !Array.isArray(requiredValue)) return false;
  const propertyNames = Object.keys(properties);
  const expectedNames = new Set<string>(expectedFields.map(({ name }) => name));
  if (
    propertyNames.length !== expectedFields.length ||
    propertyNames.some((name) => !expectedNames.has(name))
  ) {
    return false;
  }
  if (
    requiredValue.some(
      (value) => typeof value !== 'string' || !expectedNames.has(value)
    )
  ) {
    return false;
  }
  const required = new Set(
    requiredValue.filter((value): value is string => typeof value === 'string')
  );
  if (required.size !== requiredValue.length) return false;

  return expectedFields.every((field) => {
    const property = own(properties, field.name);
    return (
      own(property, 'type') === field.type &&
      required.has(field.name) === field.required
    );
  });
}

function findOpenApiOperation(
  documents: unknown[],
  rule: OperationRule
): boolean {
  return documents.some((document) => {
    const version = own(document, 'openapi');
    if (typeof version !== 'string' || !version.startsWith('3.')) return false;
    const paths = own(document, 'paths');
    const path = own(paths, rule.pathTemplate);
    const operation = own(path, rule.method);
    return (
      operation !== undefined &&
      requestShapeMatches(operation, rule.requestFields)
    );
  });
}

function documentedClaim(
  input: {
    capability: Capability;
    sourceUrl: string;
  },
  operation: ChowdeckEvidenceClaimV1['operation'],
  requestFields: EvidenceField[],
  authScheme: ChowdeckEvidenceClaimV1['authScheme'] = 'unproven'
): ChowdeckEvidenceClaimV1 {
  const isList =
    input.capability === 'menu.category.list' ||
    input.capability === 'menu.item.list';
  return {
    capability: input.capability,
    status: 'documented',
    sourceUrl: input.sourceUrl,
    sourceKind: 'official_markdown',
    operation,
    requestFields,
    responseFields: [],
    authScheme,
    pagination: isList ? 'unproven' : 'not_applicable',
    limitations: [
      'live_behavior_unproven',
      'response_semantics_unproven',
      ...(isList ? (['pagination_semantics_unproven'] as const) : []),
    ],
  };
}

export function recognizeOfficialMarkdown(input: {
  text: string;
  openApiDocuments: unknown[];
  capability: Capability;
  sourceUrl: string;
}): ChowdeckEvidenceClaimV1 | undefined {
  const rule = OPERATION_RULES[input.capability];
  if (
    rule !== undefined &&
    findOpenApiOperation(input.openApiDocuments, rule)
  ) {
    return documentedClaim(
      input,
      {
        status: 'documented',
        method: rule.method,
        pathTemplate: rule.pathTemplate,
      },
      [...rule.requestFields]
    );
  }

  if (
    input.capability === 'authentication' &&
    /^#{1,4}\s+Authentication\s*$/imu.test(input.text) &&
    /\bAuthorization(?:\s+header)?\s*(?::|scheme\s*:)\s*Bearer\b/iu.test(
      input.text
    )
  ) {
    return documentedClaim(input, { status: 'not_applicable' }, [], 'bearer');
  }

  if (
    input.capability === 'menu.manage' &&
    /^#{1,4}\s+Managing Your Menu\s*$/imu.test(input.text)
  ) {
    return documentedClaim(input, { status: 'not_applicable' }, []);
  }
  return undefined;
}
