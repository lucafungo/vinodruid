export type DataType =
  | 'inventory'
  | 'client_reserves'
  | 'contacts'
  | 'private_clients'
  | 'trade_clients'
  | 'suppliers'
  | 'sales_orders'
  | 'purchase_orders'
  | 'cellars';

export type Step = 'upload' | 'map' | 'review' | 'manual';

export interface ProcessedRow {
  id: number;
  raw: any;
  status: 'green' | 'yellow' | 'red';
  errors: string[];
  isDuplicate?: boolean;
  duplicateOf?: number;
  autoFixedFields?: string[];
  calculationLogs?: Record<string, string>;
  isPriceOutlier?: boolean;
  priceOutlierType?: 'high' | 'low' | 'global';
  priceOutlierRef?: number;
  priceOutlierRefRowId?: number;
  fieldErrors: string[];
  [key: string]: any;
}

export interface SchemaField {
  key: string;
  label: string;
  required: boolean;
  options?: string[];
}

export interface SchemaEntry {
  label: string;
  fields: SchemaField[];
}
