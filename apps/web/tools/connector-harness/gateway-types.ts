import type postgres from 'postgres';
import type { ConnectorErrorBody } from '../../src/lib/connector/errors';
export type HarnessSql = postgres.Sql;
export interface HarnessGrantContext {
  grantId: string;
  userId: string;
  merchantId: string;
  branchIds: string[];
  merchantWide: boolean;
  scopes: string[];
  grantVersion: number;
}

export interface HarnessOrderRow {
  id: string;
  merchantId: string;
  branchId: string | null;
  paymentStatus: string;
  shippingStatus: string;
  createdAt: string;
}

export interface HarnessInventoryLevel {
  variantId: string;
  sku: string | null;
  branchId: string | null;
  available: number;
  reserved: number;
  sold: number;
  lowStock: boolean;
  outOfStock: boolean;
}

export interface HarnessAnalyticsSummary {
  orders: {
    count: number;
    paidCount: number;
    paidRevenue: number;
    byShippingStatus: Array<{ status: string; count: number }>;
  };
  stock: {
    availableUnits: number;
    lowStockLevels: number;
    outOfStockLevels: number;
  };
}

export interface HarnessHttpError {
  status: number;
  body: ConnectorErrorBody;
}
