/** Statuses you may filter by or set through the API. */
export type SettableStatus = "Active" | "Sold" | "Traded" | "Private";

/**
 * An inventory record. Fields below are common to every item type. Records
 * also carry type-specific fields (for example `denomination`, `grade`,
 * `set_name`), so unknown keys are allowed and should be ignored if unused.
 */
export interface InventoryItem {
  reliqra_id: string;
  product_id?: string | null;
  title?: string | null;
  /** Current status. Reliqra may return values beyond the settable four. */
  status?: string;
  product_type?: string | null;
  quantity?: number | null;
  quantity_available?: number | null;
  value?: number | null;
  cost?: number | null;
  sold_price?: number | null;
  sold_at?: string | null;
  front_photo_url?: string | null;
  back_photo_url?: string | null;
  description_text?: string | null;
  record_extras?: Record<string, unknown> | null;
  created_at?: string;
  last_modified_at?: string;
  [field: string]: unknown;
}

/** A non-empty subset of these fields. An explicit `null` clears sold_price, cost or value. */
export interface InventoryPatch {
  status?: SettableStatus;
  sold_price?: number | null;
  cost?: number | null;
  value?: number | null;
  quantity?: number;
}

export interface Fee {
  /** For example final_value, insertion, commission, processor, shipping_label. */
  kind: string;
  amount: number;
}

export interface SaleCreate {
  item_reliqra_id: string;
  /** ISO-8601 timestamp. */
  sold_at: string;
  sold_price: number;
  marketplace: string;
  /** The marketplace's own order id. Makes the call an idempotent upsert. */
  marketplace_external_id?: string;
  quantity_sold?: number;
  fees?: Fee[];
}

export interface Sale {
  id?: string;
  item_reliqra_id?: string | null;
  sold_at?: string;
  quantity_sold?: number;
  sold_price?: number;
  tax_collected?: number | null;
  shipping_collected?: number | null;
  marketplace?: string;
  marketplace_external_id?: string | null;
  sales_order?: string | null;
  buyer_ref?: string | null;
  disposition_kind?: string | null;
  notes?: string | null;
  created_at?: string;
  last_modified_at?: string;
  [field: string]: unknown;
}

export interface ShipmentItem {
  id?: string;
  sale_id?: string | null;
  item_id?: string | null;
  created_at?: string;
}

export interface Shipment {
  id?: string;
  marketplace?: string | null;
  shipment_external_id?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
  status?: string | null;
  shipped_at?: string | null;
  ship_to_name?: string | null;
  ship_to_address?: unknown;
  label_url?: string | null;
  created_at?: string;
  last_modified_at?: string;
  shipment_items?: ShipmentItem[];
  [field: string]: unknown;
}

export interface ApiEvent {
  /** Increasing event id. Use as the `after` cursor. */
  id: number;
  /** For example inventory.updated, sale.created, shipment.updated. */
  type: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface ListParams {
  /** Page size, 1 to 500. Defaults to 100. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

export interface ListInventoryParams extends ListParams {
  status?: SettableStatus;
  /** ISO-8601 timestamp or Date. */
  updated_after?: string | Date;
}

export interface ListSalesParams extends ListParams {
  /** ISO-8601 timestamp or Date. */
  since?: string | Date;
}

export interface ListEventsParams {
  limit?: number;
  /** Return events with an id greater than this value. */
  after?: number;
}

export interface WriteOptions {
  /** A UUID. Generated automatically when omitted, so retries are safe. */
  idempotencyKey?: string;
}
