import type { ConnectorToolName } from './manifest';

interface ToolRequirement {
  resource: string;
  action: string;
}

// Resource/action per tool. The required scope is the single source of
// truth in the manifest (requiredScope), looked up below.
export const TOOL_REQUIREMENTS: Record<ConnectorToolName, ToolRequirement> = {
  'orders.list': { resource: 'orders', action: 'view' },
  'orders.get': { resource: 'orders', action: 'view' },
  'inventory.levels': { resource: 'inventory', action: 'view' },
  'analytics.summary': { resource: 'analytics', action: 'view' },
};
