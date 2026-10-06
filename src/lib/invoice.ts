import Decimal from "decimal.js";

import type { MedispeakFieldSpec } from "@/lib/ocr/medispeak";
import type { InvoiceAttentionField } from "@/lib/ocr/invoice-highlights";
import { getHeaders } from "@/lib/request";

export interface InvoiceProduct {
  id: string;
  slug: string;
  name: string;
  names?: { name: string }[];
  code?: { code: string; display?: string; system?: string };
  base_unit: { code: string; display?: string; system?: string };
}

export interface InvoiceRow {
  row: number;
  description: string;
  batch: string;
  expiry: string;
  quantity: string;
  freeQuantity: string;
  packSize: string;
  unit: string;
  mrp?: string;
  sellingPrice?: string;
  purchaseRate?: string;
  totalPurchasePrice?: string;
  discountPercent?: string;
  cgstRate?: string;
  sgstRate?: string;
  igstRate?: string;
  gstRate?: string;
}

interface InvoiceMonetaryCode {
  code: string;
  display?: string;
  system?: string;
}

export interface InvoiceMonetaryComponent {
  monetary_component_type: "base" | "tax" | "discount" | "informational";
  code?: InvoiceMonetaryCode;
  factor?: string | null;
  amount?: string | null;
  title?: string;
}

export interface InvoiceMonetaryConfig {
  instance_tax_monetary_components?: InvoiceMonetaryComponent[];
  instance_informational_codes?: InvoiceMonetaryCode[];
  instance_discount_monetary_components?: InvoiceMonetaryComponent[];
  discount_monetary_components?: InvoiceMonetaryComponent[];
  supply_delivery_extension?: {
    free_quantity?: boolean;
  };
}

export interface InvoiceDraft {
  invoiceNumber: string;
  supplier: string;
  rows: InvoiceRow[];
  errors: number[];
  rowCount: number | null;
}

export interface ImportedInvoiceItem {
  product_knowledge: InvoiceProduct;
  supplied_item?: InvoiceBatchProduct;
  charge_item_definition?: { slug: string };
  charge_item_category?: string;
  supplied_item_quantity: string;
  supplied_item_pack_quantity?: number;
  supplied_item_pack_size?: number;
  batch_number: string;
  expiry_date: string;
  unit_price?: string;
  total_purchase_price?: string;
  informational_components?: InvoiceMonetaryComponent[];
  tax_components?: InvoiceMonetaryComponent[];
  discount_components?: InvoiceMonetaryComponent[];
  _is_inward_stock: boolean;
  is_manually_edited: boolean;
  is_tax_inclusive: boolean;
  extensions: Record<string, unknown>;
}

export interface InvoiceBatchProduct {
  id: string;
  batch?: { lot_number?: string };
  expiration_date?: string;
  purchase_price?: string;
  charge_item_definition?: {
    slug: string;
    category?: { slug: string };
    price_components?: InvoiceMonetaryComponent[];
  };
}

export interface InvoiceRowIssue {
  offset: number;
  description: string;
  details: string[];
  attention: InvoiceAttentionField[];
}

export async function resolveInvoiceRows(
  rows: InvoiceRow[],
  facilityId: string,
  monetaryConfig: InvoiceMonetaryConfig,
  {
    translate,
    onRow,
    isCancelled,
    selectProduct,
  }: {
    translate: (
      key: string,
      values?: Record<string, string | number>,
    ) => string;
    onRow: (row: number) => void;
    isCancelled: () => boolean;
    selectProduct: (
      row: InvoiceRow,
      candidates: InvoiceProduct[],
    ) => Promise<InvoiceProduct | undefined>;
  },
): Promise<
  | {
      items: ImportedInvoiceItem[];
      unmatched: string[];
      issues: InvoiceRowIssue[];
    }
  | undefined
> {
  const items: ImportedInvoiceItem[] = [];
  const unmatched: string[] = [];
  const issues: InvoiceRowIssue[] = [];
  const productsCache = new Map<string, InvoiceProduct[]>();
  const defaultsCache = new Map<string, InvoiceBatchProduct | undefined>();
  const selections: {
    row: InvoiceRow;
    matches: InvoiceProduct[];
    product: Promise<InvoiceProduct | undefined>;
    searchFailed: boolean;
  }[] = [];

  for (const row of rows) {
    if (isCancelled()) return;
    onRow(row.row);
    let searchFailed = false;
    let candidates = productsCache.get(row.description);
    if (!candidates) {
      try {
        candidates = await searchInvoiceProducts(row.description, facilityId);
      } catch {
        candidates = [];
        searchFailed = true;
      }
      productsCache.set(row.description, candidates);
    }
    if (isCancelled()) return;
    const matches = getInvoiceProductMatches(candidates, row.description);
    const exact = matchInvoiceProduct(matches, row.description);
    selections.push({
      row,
      matches,
      product:
        exact || !matches.length
          ? Promise.resolve(exact)
          : selectProduct(row, matches),
      searchFailed,
    });
  }

  for (const selection of selections) {
    if (isCancelled()) return;
    const { row, matches, searchFailed } = selection;
    const product = await selection.product;
    if (isCancelled()) return;
    const details: string[] = searchFailed
      ? [translate("invoice_search_failed")]
      : [];
    const attention: InvoiceAttentionField[] = [];
    if (!product) {
      unmatched.push(
        translate(
          matches.length > 0 ? "invoice_row_skipped" : "invoice_unmatched",
          {
            description: row.description,
            row: row.row,
          },
        ),
      );
      continue;
    }

    let defaults = defaultsCache.get(product.slug);
    if (!defaultsCache.has(product.slug)) {
      try {
        defaults = await fetchInvoiceProductDefaults(product, facilityId);
        defaultsCache.set(product.slug, defaults);
      } catch {
        details.push(translate("invoice_product_defaults_missing"));
        attention.push("category", "price");
      }
    }
    if (isCancelled()) return;
    const item = prepareInvoiceItem(row, product, monetaryConfig, defaults);
    if (row.expiry && !normalizeInvoiceExpiry(row.expiry)) {
      attention.push("expiry");
      details.push(translate("invoice_expiry_required", { value: row.expiry }));
    }
    if (invoiceTaxNeedsReview(row, monetaryConfig)) {
      attention.push("tax");
      details.push(translate("invoice_tax_review"));
    }
    if (!item.batch_number) {
      attention.push("batch");
      details.push(translate("invoice_batch_required"));
    }
    if (!item.expiry_date && !row.expiry) {
      attention.push("expiry");
      details.push(translate("invoice_expiry_required", { value: "?" }));
    }
    if (!item.charge_item_category) attention.push("category");
    if (item.unit_price == null) attention.push("price");
    if (
      !item.supplied_item_pack_quantity ||
      item.supplied_item_pack_quantity < 0
    )
      attention.push("packQuantity");
    if (!item.supplied_item_pack_size || item.supplied_item_pack_size < 0)
      attention.push("packSize");
    if (
      row.mrp &&
      !item.informational_components?.some(
        (component) => component.code?.code === "mrp",
      )
    ) {
      attention.push("mrp");
      details.push(translate("invoice_mrp_review", { value: row.mrp }));
    }
    if (
      row.discountPercent &&
      !item.discount_components?.length &&
      invoiceDecimal(row.discountPercent) !== "0"
    ) {
      attention.push("tax");
      details.push(
        translate("invoice_discount_review", { value: row.discountPercent }),
      );
    }
    if (row.purchaseRate && !item.total_purchase_price) {
      attention.push("purchaseTotal");
      details.push(
        translate("invoice_purchase_rate_review", { value: row.purchaseRate }),
      );
    }
    items.push(item);
    issues.push({
      offset: items.length - 1,
      description: row.description,
      details,
      attention,
    });
  }
  return { items, unmatched, issues };
}

export function buildInvoiceFields(rowLimit: number): MedispeakFieldSpec[] {
  return [
    { key: "invoice_number", label: "Supplier invoice number", type: "string" },
    { key: "supplier", label: "Supplier name", type: "string" },
    {
      key: "row_count",
      label: "Total number of goods rows across all uploaded pages",
      type: "number",
      description:
        "Count ALL goods rows, even if there are more than the available row fields. Exclude headers, subtotals and taxes. Do not merge different batches.",
    },
    ...Array.from(
      { length: rowLimit },
      (_, index): MedispeakFieldSpec => ({
        key: `row_${index + 1}`,
        label: `Invoice goods row ${index + 1}`,
        type: "string",
        description:
          "Return a JSON object as a string with keys description, batch, expiry, quantity, free_quantity, pack_size, unit, mrp, selling_price, purchase_rate, total_purchase_price, discount_percent, cgst_rate, sgst_rate, igst_rate, gst_rate. Preserve medicine brand, strength and dosage form in description. quantity excludes free_quantity. pack_size is base units per billed unit, ONLY if explicitly printed. Preserve expiry as printed, including month/year. mrp is MRP per billed unit, NOT a row total. purchase_rate is the supplier rate per billed unit. total_purchase_price is the final amount for THIS goods row, not the invoice total. selling_price is ONLY an explicitly labelled hospital resale price per base unit, never supplier Rate/SP. Tax fields are percentages, not rupee tax amounts. gst_rate is combined GST only when explicitly printed. Do not invent CGST/SGST splits. discount_percent is a row discount percentage, not a rupee amount. All values must be strings or null. Never invent missing values. Return null for unused rows. Read rows in document order across all pages.",
      }),
    ),
  ];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

export function parseInvoiceResult(
  result: Record<string, unknown>,
  rowLimit: number,
): InvoiceDraft {
  const rows: InvoiceRow[] = [];
  const errors: number[] = [];
  for (let index = 1; index <= rowLimit; index++) {
    const raw = unwrap(result[`row_${index}`]);
    if (raw == null || raw === "" || raw === "null") continue;
    try {
      const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (value == null) continue;
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid invoice row");
      }
      const fields = value as Record<string, unknown>;
      if (!text(fields.description)) throw new Error("Missing description");
      rows.push({
        row: index,
        description: text(fields.description),
        batch: text(fields.batch),
        expiry: text(fields.expiry),
        quantity: text(fields.quantity),
        freeQuantity: text(fields.free_quantity),
        packSize: text(fields.pack_size),
        unit: text(fields.unit),
        mrp: text(fields.mrp),
        sellingPrice: text(fields.selling_price),
        purchaseRate: text(fields.purchase_rate),
        totalPurchasePrice: text(fields.total_purchase_price),
        discountPercent: text(fields.discount_percent),
        cgstRate: text(fields.cgst_rate),
        sgstRate: text(fields.sgst_rate),
        igstRate: text(fields.igst_rate),
        gstRate: text(fields.gst_rate),
      });
    } catch {
      errors.push(index);
    }
  }
  const count = Number(text(unwrap(result.row_count)) || NaN);
  return {
    invoiceNumber: text(unwrap(result.invoice_number)),
    supplier: text(unwrap(result.supplier)),
    rows,
    errors,
    rowCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
  };
}

export function isValidInvoiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function normalizeInvoiceExpiry(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/\./g, "");
  if (isValidInvoiceDate(cleaned)) return cleaned;
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const named = cleaned.match(
    /^(?:(\d{1,2})[\s/-]+)?([a-z]+)[\s/-]+(\d{4}|\d{2})$/,
  );
  const monthYear = cleaned.match(/^(\d{1,2})[/-](\d{4}|\d{2})$/);
  const yearMonth = cleaned.match(/^(\d{4})[/-](\d{1,2})$/);
  const fullDate = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const month = named
    ? months[named[2]]
    : Number(monthYear?.[1] ?? yearMonth?.[2] ?? fullDate?.[2]);
  const rawYear =
    named?.[3] ?? monthYear?.[2] ?? yearMonth?.[1] ?? fullDate?.[3];
  if (!rawYear || !month || month < 1 || month > 12) return "";
  const year = Number(rawYear) + (rawYear.length === 2 ? 2000 : 0);
  if (year < 1900 || year > 9999) return "";
  const day = Number(
    named?.[1] ??
      fullDate?.[1] ??
      new Date(Date.UTC(year, month, 0)).getUTCDate(),
  );
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidInvoiceDate(result) ? result : "";
}

function integer(value: string, minimum: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

export function invoiceDecimal(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const cleaned = value
    .trim()
    .replace(/^(?:rs\.?|inr|\u20b9)\s*/i, "")
    .replace(/%$/, "")
    .replace(/,/g, "")
    .trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  return new Decimal(cleaned).toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function invoiceTaxComponents(
  row: InvoiceRow,
  config: InvoiceMonetaryConfig,
): InvoiceMonetaryComponent[] {
  const selected: InvoiceMonetaryComponent[] = [];
  for (const [code, raw] of [
    ["cgst", row.cgstRate],
    ["sgst", row.sgstRate],
    ["igst", row.igstRate],
  ] as const) {
    const rate = invoiceDecimal(raw);
    if (rate == null || new Decimal(rate).isZero()) continue;
    const component = config.instance_tax_monetary_components?.find(
      (item) =>
        item.monetary_component_type === "tax" &&
        item.code?.code.toLowerCase() === code &&
        item.factor != null &&
        new Decimal(item.factor).equals(rate),
    );
    if (component) selected.push(component);
  }
  return selected;
}

export function invoiceTaxNeedsReview(
  row: InvoiceRow,
  config: InvoiceMonetaryConfig,
): boolean {
  const components = invoiceTaxComponents(row, config);
  const printed = [row.cgstRate, row.sgstRate, row.igstRate]
    .map(invoiceDecimal)
    .filter(
      (rate): rate is string => rate != null && !new Decimal(rate).isZero(),
    );
  const combined = invoiceDecimal(row.gstRate);
  const selectedRate = components.reduce(
    (total, item) => total.plus(item.factor ?? "0"),
    new Decimal(0),
  );
  return (
    printed.length !== components.length ||
    (combined != null && !selectedRate.equals(combined))
  );
}

export async function fetchInvoiceMonetaryConfig(
  facilityId: string,
): Promise<InvoiceMonetaryConfig> {
  const response = await fetch(
    new URL(
      `/api/v1/facility/${encodeURIComponent(facilityId)}/`,
      window.CARE_API_URL,
    ),
    { headers: getHeaders() },
  );
  if (!response.ok)
    throw new Error(
      `Facility monetary configuration unavailable (${response.status})`,
    );
  return response.json() as Promise<InvoiceMonetaryConfig>;
}

export async function fetchInvoiceExtensionConfig(): Promise<
  Pick<InvoiceMonetaryConfig, "supply_delivery_extension">
> {
  const response = await fetch(
    new URL("/api/v1/extensions/", window.CARE_API_URL),
    { headers: getHeaders() },
  );
  if (!response.ok)
    throw new Error(`Extension configuration unavailable (${response.status})`);
  const registry = (await response.json()) as {
    supply_delivery?: {
      name: string;
      write_schema?: { properties?: Record<string, { type?: string }> };
    }[];
  };
  const extension = registry.supply_delivery?.find(
    (entry) => entry.name === "supply_delivery_extension",
  );
  if (!extension) return {};
  return {
    supply_delivery_extension: {
      free_quantity:
        extension.write_schema?.properties?.free_quantity?.type === "integer",
    },
  };
}

export async function fetchInvoiceProductDefaults(
  product: InvoiceProduct,
  facilityId: string,
): Promise<InvoiceBatchProduct | undefined> {
  const url = new URL(
    `/api/v1/facility/${encodeURIComponent(facilityId)}/product/`,
    window.CARE_API_URL,
  );
  url.search = new URLSearchParams({
    product_knowledge: product.slug,
    status: "active",
    ordering: "-created_date",
    limit: "1",
  }).toString();
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok)
    throw new Error(`Product defaults unavailable (${response.status})`);
  const data = (await response.json()) as { results: InvoiceBatchProduct[] };
  return data.results[0];
}

export function prepareInvoiceItem(
  row: InvoiceRow,
  product: InvoiceProduct,
  config: InvoiceMonetaryConfig = {},
  defaults?: InvoiceBatchProduct,
): ImportedInvoiceItem {
  const quantity = integer(row.quantity, 0);
  const freeQuantity = integer(row.freeQuantity || "0", 0);
  const packSize = integer(row.packSize || "1", 1);
  const packs =
    quantity != null && freeQuantity != null
      ? quantity + freeQuantity
      : undefined;
  const units =
    packs != null && packSize != null ? packs * packSize : undefined;
  const taxComponents = invoiceTaxComponents(row, config);
  const mrp = invoiceDecimal(row.mrp);
  const mrpCode = config.instance_informational_codes?.find(
    (code) => code.code === "mrp",
  );
  const sellingPrice = invoiceDecimal(row.sellingPrice);
  const hasTaxRate = [
    row.cgstRate,
    row.sgstRate,
    row.igstRate,
    row.gstRate,
  ].some((rate) => invoiceDecimal(rate) != null);
  const taxInclusive =
    sellingPrice == null &&
    mrp != null &&
    !!mrpCode &&
    packSize != null &&
    hasTaxRate &&
    !invoiceTaxNeedsReview(row, config);
  const taxRate = taxComponents.reduce(
    (total, component) => total.plus(component.factor ?? "0"),
    new Decimal(0),
  );
  const unitPrice =
    sellingPrice ??
    (taxInclusive
      ? new Decimal(mrp!)
          .dividedBy(new Decimal(1).plus(taxRate.dividedBy(100)))
          .dividedBy(packSize!)
          .toFixed(6)
      : undefined);
  const discountRate = invoiceDecimal(row.discountPercent);
  const discount =
    discountRate == null
      ? undefined
      : [
          ...(config.discount_monetary_components ?? []),
          ...(config.instance_discount_monetary_components ?? []),
        ].find(
          (component) =>
            component.monetary_component_type === "discount" &&
            component.factor != null &&
            new Decimal(component.factor).equals(discountRate),
        );
  const item: ImportedInvoiceItem = {
    product_knowledge: product,
    supplied_item_quantity:
      units != null && Number.isSafeInteger(units) && units > 0
        ? String(units)
        : "",
    supplied_item_pack_quantity: packs,
    supplied_item_pack_size: packSize ?? undefined,
    batch_number: row.batch.trim(),
    expiry_date: normalizeInvoiceExpiry(row.expiry),
    unit_price: unitPrice,
    total_purchase_price: invoiceDecimal(row.totalPurchasePrice),
    informational_components:
      mrp != null && mrpCode
        ? [
            {
              monetary_component_type: "informational",
              code: mrpCode,
              amount: mrp,
            },
          ]
        : [],
    tax_components: taxComponents,
    discount_components: discount ? [discount] : [],
    _is_inward_stock: true,
    is_manually_edited: true,
    is_tax_inclusive: taxInclusive,
    extensions:
      config.supply_delivery_extension?.free_quantity && freeQuantity != null
        ? { supply_delivery_extension: { free_quantity: freeQuantity } }
        : {},
  };
  if (!defaults) return item;

  const charge = defaults.charge_item_definition;
  const components = charge?.price_components ?? [];
  const defaultExpiry = normalizeInvoiceExpiry(
    defaults.expiration_date?.slice(0, 10) ?? "",
  );
  const defaultBatch = defaults.batch?.lot_number ?? "";
  const defaultPrice =
    components.find((component) => component.monetary_component_type === "base")
      ?.amount ?? undefined;
  const defaultTaxes = components.filter(
    (component) => component.monetary_component_type === "tax",
  );
  const defaultDiscounts = components.filter(
    (component) => component.monetary_component_type === "discount",
  );
  const defaultInformation = components.filter(
    (component) => component.monetary_component_type === "informational",
  );
  const hasExplicitTaxes = [
    row.cgstRate,
    row.sgstRate,
    row.igstRate,
    row.gstRate,
  ].some((rate) => invoiceDecimal(rate) != null);

  item.batch_number = item.batch_number || defaultBatch;
  item.expiry_date = item.expiry_date || defaultExpiry;
  item.unit_price = item.unit_price ?? defaultPrice;
  item.tax_components =
    hasExplicitTaxes && !invoiceTaxNeedsReview(row, config)
      ? taxComponents
      : defaultTaxes;
  item.discount_components =
    discountRate === "0" ? [] : discount ? [discount] : defaultDiscounts;
  item.informational_components = [...defaultInformation];
  if (mrp != null && mrpCode) {
    item.informational_components = [
      ...defaultInformation.filter(
        (component) => component.code?.code !== mrpCode.code,
      ),
      { monetary_component_type: "informational", code: mrpCode, amount: mrp },
    ];
  }
  if (
    item.total_purchase_price == null &&
    !row.purchaseRate &&
    defaults.purchase_price != null &&
    units != null &&
    units > 0
  ) {
    item.total_purchase_price = new Decimal(defaults.purchase_price)
      .times(units)
      .toFixed(6);
  }
  item.supplied_item = defaults;
  item.charge_item_definition = charge ? { slug: charge.slug } : undefined;
  item.charge_item_category = charge?.category?.slug;
  const sameAmount = (first?: string | null, second?: string | null) => {
    if (first == null || second == null) return first == null && second == null;
    return new Decimal(first).equals(second);
  };
  const sameComponents = (
    first: InvoiceMonetaryComponent[],
    second: InvoiceMonetaryComponent[],
  ) =>
    first.length === second.length &&
    first.every((component) =>
      second.some(
        (other) =>
          component.monetary_component_type === other.monetary_component_type &&
          component.code?.code === other.code?.code &&
          component.code?.system === other.code?.system &&
          sameAmount(component.factor, other.factor) &&
          sameAmount(component.amount, other.amount),
      ),
    );
  item.is_manually_edited =
    item.batch_number !== defaultBatch ||
    item.expiry_date !== defaultExpiry ||
    !sameAmount(item.unit_price, defaultPrice) ||
    !sameComponents(item.tax_components, defaultTaxes) ||
    !sameComponents(item.discount_components, defaultDiscounts) ||
    !sameComponents(item.informational_components, defaultInformation);
  return item;
}

export function isEmptyInvoiceTarget(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const allowed = new Set([
    "product_knowledge",
    "supplied_inventory_item",
    "supplied_item_quantity",
    "supplied_item_pack_quantity",
    "supplied_item_pack_size",
    "supplied_item",
    "supply_request",
    "_is_inward_stock",
    "is_tax_inclusive",
    "extensions",
    "batch_number",
    "expiry_date",
    "unit_price",
    "is_manually_edited",
  ]);
  if (Object.keys(item).some((key) => !allowed.has(key))) return false;
  const product = item.product_knowledge as
    | { slug?: string; name?: string }
    | undefined;
  return (
    !product?.slug &&
    !product?.name &&
    !item.supplied_item &&
    !item.supply_request &&
    !item.supplied_inventory_item &&
    !item.batch_number &&
    !item.expiry_date &&
    !item.is_manually_edited &&
    (item.supplied_item_quantity == null ||
      ["", "1", "1.00"].includes(String(item.supplied_item_quantity))) &&
    (item.supplied_item_pack_quantity == null ||
      item.supplied_item_pack_quantity === 1) &&
    (item.supplied_item_pack_size == null ||
      item.supplied_item_pack_size === 1) &&
    (item.unit_price == null ||
      ["", "0", "0.00"].includes(String(item.unit_price))) &&
    Object.keys((item.extensions as Record<string, unknown>) ?? {}).length === 0
  );
}

function withoutPackCount(value: string): string {
  return value
    .replace(
      /\(\s*\d+(?:\s*[xX]\s*\d+)*\s*(?:tablets?|tables|tabs?|capsules?|caps?|strips?|packs?|pieces?|pcs)\s*\)/gi,
      " ",
    )
    .replace(
      /\b\d+(?:\s*[xX]\s*\d+)*\s*(?:tablets?|tables|tabs?|capsules?|caps?|strips?|packs?|pieces?|pcs)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function buildProductQueries(description: string): string[] {
  const original = withoutPackCount(description);
  const cleaned = original.replace(/(\d+(?:\.\d+)?)\s*gms?\b/gi, "$1 g");
  const separated = cleaned.replace(/([a-z])(\d)/gi, "$1 $2");
  const queries = new Set<string>([
    original,
    cleaned,
    separated,
    cleaned.replace(/[\s-]+/g, ""),
  ]);
  const spaced = separated.replace(
    /(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|ml)\b/gi,
    (_, amount: string, unit: string) => `${amount} ${unit.toLowerCase()}`,
  );
  queries.add(spaced);
  queries.add(spaced.replace(/(\d+(?:\.\d+)?)\s+(mg|mcg|g|iu|ml)\b/gi, "$1$2"));
  const bareNumber = separated.match(/\b(\d{2,4})\b/);
  if (bareNumber && !/(mg|mcg|g|iu|ml)\b/i.test(separated)) {
    const baseName = separated.replace(bareNumber[0], "").trim();
    queries.add(`${baseName} ${bareNumber[1]} mg`);
    queries.add(`${baseName} ${bareNumber[1]}mg`);
  }
  queries.add(
    separated
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return [...queries].filter((query) => query.length >= 2);
}

function normalized(value: string): string {
  return withoutPackCount(value)
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*gms?\b/g, "$1g")
    .replace(/(\d)\s+(mg|mcg|g|iu|ml)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreInvoiceProduct(
  product: InvoiceProduct,
  description: string,
): number {
  const names = [
    product.name,
    ...(product.names?.map((name) => name.name) ?? []),
    product.code?.display ?? "",
  ]
    .filter(Boolean)
    .map(normalized);
  const query = normalized(description);
  const strengths = query.match(/\d+(?:\.\d+)?(?:mg|mcg|g|iu|ml)?/g) ?? [];
  const queries = buildProductQueries(description).map(normalized);
  const queryTokens =
    query.match(/[a-z]+|\d+(?:\.\d+)?(?:mg|mcg|g|iu|ml)?/g) ?? [];
  const genericWords = new Set([
    "inj",
    "injection",
    "gel",
    "tab",
    "tablet",
    "tablets",
    "cap",
    "capsule",
    "capsules",
    "syrup",
    "vial",
    "solution",
    "cream",
    "ointment",
    "suspension",
    "drops",
    "ml",
    "mg",
    "mcg",
    "g",
    "iu",
    "containing",
    "product",
  ]);
  let bestDoseAware = 0;
  let bestGeneric = 0;
  for (const name of names) {
    const nameHasStrength = /\d/.test(name);
    if (
      strengths.length &&
      nameHasStrength &&
      !strengths.every((strength) => {
        const amount = strength.match(/^\d+(?:\.\d+)?/)![0];
        const unit = strength.slice(amount.length);
        const unitPattern = unit ? `(?:${unit})?` : "(?:mg|mcg|g|iu|ml)?";
        const pattern = new RegExp(
          `(?:^|[^\\d.])${amount.replace(/\./g, "\\.")}${unitPattern}(?![\\d.a-z])`,
        );
        return pattern.test(name);
      })
    )
      continue;
    for (const variant of queries) {
      const compactName = name.replace(/[\s-]+/g, "");
      const compactQuery = variant.replace(/[\s-]+/g, "");
      let score =
        compactName === compactQuery
          ? 100
          : compactName.startsWith(compactQuery) ||
              compactQuery.startsWith(compactName)
            ? 85
            : compactName.includes(compactQuery) ||
                compactQuery.includes(compactName)
              ? 70
              : 0;
      if (strengths.length && !nameHasStrength) score = Math.min(score, 70);
      if (/\d/.test(variant)) {
        bestDoseAware = Math.max(bestDoseAware, score);
      } else {
        bestGeneric = Math.max(bestGeneric, score);
      }
    }
    const nameTokens =
      name.match(/[a-z]+|\d+(?:\.\d+)?(?:mg|mcg|g|iu|ml)?/g) ?? [];
    const sharedTokens = queryTokens.filter((token) =>
      nameTokens.includes(token),
    );
    if (
      sharedTokens.some(
        (token) => /^[a-z]/.test(token) && !genericWords.has(token),
      )
    ) {
      bestGeneric = Math.max(
        bestGeneric,
        Math.min(
          70,
          Math.round(
            (100 * sharedTokens.length) /
              Math.max(queryTokens.length, nameTokens.length),
          ),
        ),
      );
    }
  }
  const best = bestDoseAware > 0 ? bestDoseAware : bestGeneric;
  return Math.max(
    0,
    names.some((name) => name.includes("containing product"))
      ? best - 25
      : best,
  );
}

export function getInvoiceProductMatches(
  candidates: InvoiceProduct[],
  description: string,
): InvoiceProduct[] {
  return [
    ...new Map(candidates.map((product) => [product.slug, product])).values(),
  ]
    .map((product) => ({
      product,
      score: scoreInvoiceProduct(product, description),
    }))
    .filter(({ score }) => score >= 20)
    .sort((first, second) => second.score - first.score)
    .map(({ product }) => product);
}

export function matchInvoiceProduct(
  candidates: InvoiceProduct[],
  description: string,
): InvoiceProduct | undefined {
  const query = normalized(description).replace(/[\s-]+/g, "");
  if (!query) return undefined;
  const matches = getInvoiceProductMatches(candidates, description).filter(
    (product) =>
      [
        product.name,
        ...(product.names?.map((name) => name.name) ?? []),
        product.code?.display ?? "",
      ].some((name) => normalized(name).replace(/[\s-]+/g, "") === query),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export async function searchInvoiceProducts(
  description: string,
  facilityId: string,
): Promise<InvoiceProduct[]> {
  const products = new Map<string, InvoiceProduct>();
  for (const query of buildProductQueries(description)) {
    const url = new URL("/api/v1/product_knowledge/", window.CARE_API_URL);
    url.search = new URLSearchParams({
      facility: facilityId,
      include_instance: "true",
      status: "active",
      name: query,
      limit: "20",
      offset: "0",
    }).toString();
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok)
      throw new Error(`Product search failed (${response.status})`);
    const data = (await response.json()) as { results: InvoiceProduct[] };
    for (const product of data.results) products.set(product.slug, product);
  }
  return [...products.values()].sort(
    (first, second) =>
      scoreInvoiceProduct(second, description) -
      scoreInvoiceProduct(first, description),
  );
}
