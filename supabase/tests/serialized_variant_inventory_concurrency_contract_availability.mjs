import { serializedInventoryNestedQueries } from './serialized_variant_inventory_concurrency_contract_nested_queries.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  escapeRegex,
  hasConstantFalseConjunct,
  isRequiredConjunct,
  isRequiredGroupedConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;
const { maskNestedQueries } = serializedInventoryNestedQueries;

function availableUnitWhereClause(source, preserveStrings = false) {
  const cleanSource = maskNestedQueries(
    maskSqlLiterals(stripSqlComments(source), { preserveStrings })
  );
  for (const { index, text } of splitSqlStatements(cleanSource)) {
    const match =
      /FROM\s+(?:public\s*\.\s*)?variant_inventory(?:\s+(?:AS\s+)?(?!WHERE\b|ORDER\b|LIMIT\b|FOR\b)([a-z_][a-z0-9_]*))?\s+WHERE\b([\s\S]*?)\bORDER\s+BY\b([\s\S]*?)\bLIMIT\s+v_needed\s+FOR\s+UPDATE\s+SKIP\s+LOCKED/i.exec(
        text
      );
    if (match && !/\b(?:OFFSET|FETCH)\b/i.test(text)) {
      return {
        alias: match[1],
        index: index + match.index,
        orderBy: match[3],
        where: match[2],
      };
    }
  }
  return null;
}

const allowedAvailabilityColumns = new Set([
  'merchant_id',
  'variant_id',
  'status',
  'order_id',
  'order_item_id',
  'sold_at',
  'branch_id',
]);

function hasUnexpectedAvailabilityPredicate(where) {
  for (const match of where.matchAll(
    /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)\s*(?:=|<>|!=|<=?|>=?|IS\b|IN\b|LIKE\b|ILIKE\b|BETWEEN\b)/gi
  )) {
    if (!allowedAvailabilityColumns.has(match[2].toLowerCase())) return true;
  }
  return false;
}

function availableUnitPredicatePatterns(variantVariable, alias) {
  const qualifier = alias
    ? `${escapeRegex(alias)}\\s*\\.\\s*`
    : '(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?';
  return [
    new RegExp(`${qualifier}merchant_id\\s*=\\s*p_merchant_id\\b`, 'i'),
    new RegExp(
      `${qualifier}variant_id\\s*=\\s*${escapeRegex(variantVariable)}\\b`,
      'i'
    ),
    new RegExp(`${qualifier}status\\s*=\\s*'available'`, 'i'),
    new RegExp(`${qualifier}order_id\\s+IS\\s+NULL`, 'i'),
    new RegExp(`${qualifier}order_item_id\\s+IS\\s+NULL`, 'i'),
    new RegExp(`${qualifier}sold_at\\s+IS\\s+NULL`, 'i'),
  ];
}

function availableUnitPredicatesMatch(source, variantVariable, branchVariable) {
  const query = availableUnitWhereClause(source);
  const valueQuery = availableUnitWhereClause(source, true);
  const patterns = availableUnitPredicatePatterns(
    variantVariable,
    query?.alias
  );
  const branchQualifier = query?.alias
    ? `${escapeRegex(query.alias)}\\s*\\.\\s*`
    : '(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?';
  const branchPattern = branchVariable
    ? new RegExp(
        `\\(\\s*${escapeRegex(branchVariable)}\\s+IS\\s+NULL\\s+AND\\s+${branchQualifier}branch_id\\s+IS\\s+NULL\\s*\\)\\s+OR\\s+\\(\\s*${escapeRegex(branchVariable)}\\s+IS\\s+NOT\\s+NULL\\s+AND\\s+\\(\\s*${branchQualifier}branch_id\\s*=\\s*${escapeRegex(branchVariable)}\\b\\s+OR\\s+${branchQualifier}branch_id\\s+IS\\s+NULL\\s*\\)\\s*\\)`,
        'i'
      )
    : null;
  const branchMatch = branchPattern?.exec(valueQuery?.where ?? '');
  const branchFirst = branchVariable
    ? new RegExp(
        `^\\s*(?:\\(\\s*)*CASE\\s+WHEN\\s+${branchQualifier}branch_id\\s*=\\s*${escapeRegex(branchVariable)}\\b\\s+THEN\\s+0\\s+ELSE\\s+1\\s+END(?:\\s*\\))*\\s+ASC(?:\\s*,|\\s*$)`,
        'i'
      ).test(valueQuery?.orderBy ?? '')
    : true;
  const branchScopedWhere = branchMatch
    ? valueQuery.where.replace(branchMatch[0], 'branch_eligible = true')
    : valueQuery?.where;
  const contradictoryStatus = new RegExp(
    `(?:${branchQualifier}status\\s*=\\s*'(?!available')[^']+'|${branchQualifier}status\\s*(?:<>|!=|IS\\s+DISTINCT\\s+FROM)\\s*'available'|${branchQualifier}status\\s+NOT\\s+IN\\s*\\([^)]*'available'|${branchQualifier}status\\s+IN\\s*\\((?![^)]*'available')[^)]*\\)|${branchQualifier}status\\s*=\\s*ANY\\s*\\(\\s*(?:ARRAY\\s*)?\\[(?![^\\]]*'available')[^\\]]*\\]\\s*\\)|NOT\\s*\\(\\s*${branchQualifier}status\\s*=\\s*'available'\\s*\\)|\\(\\s*${branchQualifier}status\\s*=\\s*'available'\\s*\\)\\s+IS\\s+FALSE|${branchQualifier}status\\s+(?:IS\\s+NULL|ISNULL)\\b)`,
    'i'
  );
  const contradictoryScope = new RegExp(
    `(?:${branchQualifier}(?:merchant_id\\s*(?:<>|!=|IS\\s+DISTINCT\\s+FROM)\\s*p_merchant_id|merchant_id\\s+(?:IS\\s+NULL|ISNULL)\\b|merchant_id\\s*=(?!\\s*p_merchant_id\\b)|variant_id\\s*(?:<>|!=|IS\\s+DISTINCT\\s+FROM)\\s*${escapeRegex(variantVariable)}\\b|variant_id\\s+(?:IS\\s+NULL|ISNULL)\\b|variant_id\\s*=(?!\\s*${escapeRegex(variantVariable)}\\b)|order_id\\s+(?:IS\\s+NOT\\s+NULL|NOTNULL)\\b|order_id\\s*=|order_item_id\\s+(?:IS\\s+NOT\\s+NULL|NOTNULL)\\b|order_item_id\\s*=|sold_at\\s+(?:IS\\s+NOT\\s+NULL|NOTNULL)\\b|sold_at\\s*=))`,
    'i'
  );
  const branchNarrowing = new RegExp(`${branchQualifier}branch_id\\s*=`, 'i');
  return (
    query !== null &&
    valueQuery !== null &&
    patterns.every((pattern, index) =>
      isRequiredConjunct(index === 2 ? valueQuery.where : query.where, pattern)
    ) &&
    !contradictoryStatus.test(valueQuery.where) &&
    !contradictoryScope.test(valueQuery.where) &&
    !hasConstantFalseConjunct(valueQuery.where) &&
    !branchNarrowing.test(branchScopedWhere ?? '') &&
    !hasUnexpectedAvailabilityPredicate(branchScopedWhere ?? '') &&
    branchFirst &&
    (!branchPattern ||
      (branchMatch !== null &&
        isRequiredGroupedConjunct(
          branchScopedWhere,
          /^\s*branch_eligible\s*=\s*true\s*$/i
        )))
  );
}

export const serializedInventoryAvailability = {
  availableUnitWhereClause,
  availableUnitPredicatesMatch,
};
