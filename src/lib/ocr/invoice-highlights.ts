export type InvoiceAttentionField =
  | "batch"
  | "expiry"
  | "category"
  | "packSize"
  | "packQuantity"
  | "quantity"
  | "price"
  | "mrp"
  | "purchaseTotal"
  | "tax";

export interface InvoiceRowHighlight {
  index: number;
  attention: InvoiceAttentionField[];
  mrpIndex?: number;
}

export type InvoiceHighlightCleanup = (() => void) & {
  add: (mark: InvoiceRowHighlight) => void;
};

export function scrollToInvoiceRow(scope: HTMLElement, index: number) {
  const row = scope
    .querySelector<HTMLInputElement>(`input[name="items.${index}.expiry_date"]`)
    ?.closest("tr");
  if (!row) return;
  row.classList.remove("invoice-ocr-filled");
  void row.offsetWidth;
  row.classList.add("invoice-ocr-filled");
  const target =
    row.querySelector<HTMLElement>(".invoice-ocr-attention") ??
    row.cells[0] ??
    row;
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
    inline: "center",
  });
  const timer = setTimeout(
    () => row.classList.remove("invoice-ocr-filled"),
    2000,
  );
  return () => {
    clearTimeout(timer);
    row.classList.remove("invoice-ocr-filled");
  };
}

export async function fillInvoiceRowsSequentially(
  scope: HTMLElement,
  marks: InvoiceRowHighlight[],
  fillRow: (index: number) => void,
  onFilled: (mark: InvoiceRowHighlight) => void,
  isCancelled: () => boolean,
): Promise<boolean> {
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const pause = (milliseconds: number) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, reducedMotion ? 0 : milliseconds),
    );
  await nextFrame();
  await nextFrame();
  for (const mark of marks) {
    if (isCancelled()) return false;
    const row = scope
      .querySelector<HTMLInputElement>(
        `input[name="items.${mark.index}.expiry_date"]`,
      )
      ?.closest("tr");
    if (!row) throw new Error("Invoice row is not available for filling");
    row.classList.add("invoice-ocr-active");
    row.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
    try {
      await pause(150);
      if (isCancelled()) return false;
      fillRow(mark.index);
      await nextFrame();
      onFilled(mark);
      await pause(500);
    } finally {
      row.classList.remove("invoice-ocr-active");
    }
  }
  return true;
}

export function markInvoiceRows(
  scope: HTMLElement,
  marks: InvoiceRowHighlight[],
  attentionLabel: string,
): InvoiceHighlightCleanup {
  const pending = new Set(marks);
  const rows = new Set<HTMLTableRowElement>();
  const fields = new Map<
    HTMLElement,
    { title: string | null; description: string | null; value: string }
  >();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let frame = 0;

  const fieldValue = (element: HTMLElement) =>
    [
      element.textContent ?? "",
      ...Array.from(element.querySelectorAll<HTMLInputElement>("input")).map(
        (input) => input.value,
      ),
    ].join("|");

  const clearField = (element: HTMLElement) => {
    const original = fields.get(element);
    if (!original) return;
    element.classList.remove("invoice-ocr-attention");
    for (const property of ["top", "left", "width", "height"]) {
      element.style.removeProperty(`--invoice-attention-${property}`);
    }
    if (original.title == null) element.removeAttribute("title");
    else element.setAttribute("title", original.title);
    if (original.description == null)
      element.removeAttribute("aria-description");
    else element.setAttribute("aria-description", original.description);
    fields.delete(element);
  };

  const sizeFieldRing = (cell: HTMLElement) => {
    const controls = Array.from(
      cell.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="checkbox"]), [role="combobox"], button',
      ),
    );
    const control = controls.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });
    if (!control) return;
    const input = control.getBoundingClientRect();
    const container = cell.getBoundingClientRect();
    const gap = 4;
    cell.style.setProperty(
      "--invoice-attention-top",
      `${input.top - container.top - gap}px`,
    );
    cell.style.setProperty(
      "--invoice-attention-left",
      `${input.left - container.left - gap}px`,
    );
    cell.style.setProperty(
      "--invoice-attention-width",
      `${input.width + gap * 2}px`,
    );
    cell.style.setProperty(
      "--invoice-attention-height",
      `${input.height + gap * 2}px`,
    );
  };

  const apply = () => {
    for (const mark of pending) {
      const expiry = scope.querySelector<HTMLInputElement>(
        `input[name="items.${mark.index}.expiry_date"]`,
      );
      const row = expiry?.closest("tr");
      if (!row) continue;
      pending.delete(mark);
      rows.add(row);
      row.classList.add("invoice-ocr-filled");
      timers.push(
        setTimeout(() => row.classList.remove("invoice-ocr-filled"), 1800),
      );
      const table = row.closest("table");
      const informationCount = Math.max(
        0,
        (table?.tHead?.rows[1]?.cells.length ?? 3) - 3,
      );
      const column: Record<InvoiceAttentionField, number> = {
        batch: 1,
        expiry: 2,
        category: 3,
        packSize: 4,
        packQuantity: 5,
        quantity: 6,
        price: 7,
        mrp:
          mark.mrpIndex != null &&
          mark.mrpIndex >= 0 &&
          mark.mrpIndex < informationCount
            ? 8 + mark.mrpIndex
            : 7,
        purchaseTotal: 9 + informationCount,
        tax: 10 + informationCount,
      };
      for (const field of new Set(mark.attention)) {
        const cell = row.cells[column[field]];
        if (!cell || fields.has(cell)) continue;
        fields.set(cell, {
          title: cell.getAttribute("title"),
          description: cell.getAttribute("aria-description"),
          value: fieldValue(cell),
        });
        cell.classList.add("invoice-ocr-attention");
        cell.setAttribute("title", attentionLabel);
        cell.setAttribute("aria-description", attentionLabel);
      }
    }
    for (const [field, original] of fields) {
      if (!field.isConnected || fieldValue(field) !== original.value)
        clearField(field);
      else sizeFieldRing(field);
    }
  };

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const onEdit = (event: Event) => {
    if (!(event.target instanceof HTMLElement)) return;
    for (const field of fields.keys()) {
      if (field.contains(event.target)) clearField(field);
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(scope, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(scope);
  window.addEventListener("resize", schedule);
  scope.addEventListener("input", onEdit, true);
  scope.addEventListener("change", onEdit, true);
  scope.addEventListener("focusout", schedule, true);
  schedule();

  const cleanup = () => {
    observer.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener("resize", schedule);
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    rows.forEach((row) => row.classList.remove("invoice-ocr-filled"));
    for (const field of fields.keys()) clearField(field);
    scope.removeEventListener("input", onEdit, true);
    scope.removeEventListener("change", onEdit, true);
    scope.removeEventListener("focusout", schedule, true);
  };
  return Object.assign(cleanup, {
    add: (mark: InvoiceRowHighlight) => {
      pending.add(mark);
      schedule();
    },
  });
}
