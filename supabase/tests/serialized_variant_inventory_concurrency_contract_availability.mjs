import { serializedInventoryNestedQueries } from './serialized_variant_inventory_concurrency_contract_nested_queries.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  isRequiredConjunct,
  isRequiredGroupedConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;
const { maskNestedQueries } = serializedInventoryNestedQueries;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    `(?:${branchQualifier}status\\s*(?:<>|!=)\\s*'available'|${branchQualifier}status\\s+NOT\\s+IN\\s*\\([^)]*'available'|NOT\\s*\\(\\s*${branchQualifier}status\\s*=\\s*'available'\\s*\\)|\\(\\s*${branchQualifier}status\\s*=\\s*'available'\\s*\\)\\s+IS\\s+FALSE)`,
    'i'
  );
  return (
    query !== null &&
    valueQuery !== null &&
    patterns.every((pattern, index) =>
      isRequiredConjunct(index === 2 ? valueQuery.where : query.where, pattern)
    ) &&
    !contradictoryStatus.test(valueQuery.where) &&
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
