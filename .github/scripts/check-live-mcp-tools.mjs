#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  DEFAULT_REQUIRED_TOOLS,
  DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
} from './mcp-tool-contracts.mjs';

export { DEFAULT_REQUIRED_TOOLS, DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS };

const DEFAULT_HEALTH_URL = 'https://mcp.ogabassey.com/health';
const DEFAULT_MCP_URL = 'https://mcp.ogabassey.com/mcp';
const FETCH_ATTEMPTS = 5;
const FETCH_RETRY_DELAY_MS = 2000;
let timeoutMs = 15000;
const healthUrl = process.env.MCP_HEALTH_URL || DEFAULT_HEALTH_URL;
const mcpUrl = process.env.MCP_SMOKE_URL || DEFAULT_MCP_URL;
const requiredTools = parseRequiredTools(
  process.env.MCP_REQUIRED_TOOLS,
  DEFAULT_REQUIRED_TOOLS
);

async function main() {
  timeoutMs = parseTimeoutMs(process.env.MCP_SMOKE_TIMEOUT_MS, timeoutMs);
  await assertHealthy(healthUrl);
  const tools = await listTools(mcpUrl);
  const toolNames = tools.map((tool) => tool.name).sort();
  const toolNameSet = new Set(toolNames);
  const missingTools = requiredTools.filter((tool) => !toolNameSet.has(tool));

  if (missingTools.length > 0) {
    throw new Error(
      [
        `MCP production smoke failed for ${mcpUrl}.`,
        `Missing tools: ${missingTools.join(', ')}`,
        `Live tools: ${toolNames.join(', ')}`,
      ].join('\n')
    );
  }

  const schemaErrors = validateToolSchemaContracts(
    tools,
    DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
    requiredTools
  );

  if (schemaErrors.length > 0) {
    throw new Error(
      [
        `MCP production smoke failed for ${mcpUrl}.`,
        'Invalid tool schemas:',
        ...schemaErrors.map((error) => `- ${error}`),
      ].join('\n')
    );
  }

  console.log(
    `MCP production smoke passed for ${mcpUrl}: ${toolNames.length} tools`
  );
  console.log(`Verified tools: ${requiredTools.join(', ')}`);
  console.log(
    `Verified schema contracts: ${Object.keys(DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS)
      .filter((tool) => requiredTools.includes(tool))
      .join(', ')}`
  );
}

async function assertHealthy(url) {
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`MCP health check failed for ${url}: HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.status !== 'healthy') {
    throw new Error(
      `MCP health check returned non-healthy status: ${JSON.stringify(body)}`
    );
  }
}

async function listTools(url) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`MCP tools/list failed for ${url}: HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.error) {
    throw new Error(`MCP tools/list returned error: ${JSON.stringify(body.error)}`);
  }

  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`MCP tools/list returned an invalid body: ${JSON.stringify(body)}`);
  }

  return tools.filter(
    (tool) => tool && typeof tool === 'object' && typeof tool.name === 'string'
  );
}

function formatErrorCause(cause) {
  if (cause instanceof Error) {
    return cause.message;
  }

  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

async function fetchWithTimeout(url, init) {
  let lastError;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok || response.status < 500 || attempt === FETCH_ATTEMPTS) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn(
        `[Attempt ${attempt}/${FETCH_ATTEMPTS}] Failed to fetch ${url}: ${
          error instanceof Error ? error.message : error
        }`,
        error && typeof error === 'object' && 'cause' in error && error.cause
          ? `(Cause: ${formatErrorCause(error.cause)})`
          : ''
      );
      if (attempt === FETCH_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    }

    await sleep(FETCH_RETRY_DELAY_MS * attempt);
  }

  throw lastError;
}

export function validateToolSchemaContracts(tools, contracts, requiredTools) {
  const requiredToolSet = new Set(requiredTools);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const errors = [];

  for (const [toolName, contract] of Object.entries(contracts)) {
    if (!requiredToolSet.has(toolName)) continue;

    const tool = toolByName.get(toolName);
    if (!tool) {
      errors.push(`${toolName} is missing`);
      continue;
    }

    errors.push(...validateToolSchemaContract(toolName, tool.inputSchema, contract));
  }

  return errors;
}

function validateToolSchemaContract(toolName, schema, contract) {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return [`${toolName} is missing inputSchema`];
  }

  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : null;

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const requiredField of contract.required) {
    if (!required.includes(requiredField)) {
      errors.push(`${toolName} inputSchema.required missing ${requiredField}`);
    }
  }

  if (!properties || Object.keys(properties).length === 0) {
    errors.push(`${toolName} inputSchema.properties is empty`);
    return errors;
  }

  for (const propertyName of contract.properties) {
    if (!properties[propertyName]) {
      errors.push(`${toolName} inputSchema.properties missing ${propertyName}`);
    }
  }

  const itemArraySchema = properties[contract.itemArrayProperty];
  if (!itemArraySchema || itemArraySchema.type !== 'array') {
    errors.push(
      `${toolName} inputSchema.properties.${contract.itemArrayProperty} must be an array`
    );
    return errors;
  }

  const itemProperties =
    itemArraySchema.items?.properties &&
    typeof itemArraySchema.items.properties === 'object'
      ? itemArraySchema.items.properties
      : null;

  if (!itemProperties || Object.keys(itemProperties).length === 0) {
    errors.push(
      `${toolName} inputSchema.properties.${contract.itemArrayProperty}.items.properties is empty`
    );
    return errors;
  }

  for (const propertyName of contract.itemProperties) {
    if (!itemProperties[propertyName]) {
      errors.push(
        `${toolName} inputSchema.properties.${contract.itemArrayProperty}.items.properties missing ${propertyName}`
      );
    }
  }

  return errors;
}

export function parseRequiredTools(value, fallback) {
  if (!value) return fallback;

  const parsed = value
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

export function parseTimeoutMs(value, fallback) {
  if (value == null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid MCP_SMOKE_TIMEOUT_MS: "${value}". Expected a positive integer in milliseconds.`
    );
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
