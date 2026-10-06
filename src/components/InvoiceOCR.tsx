import * as SelectPrimitive from "@radix-ui/react-select";
import {
  AlertCircle,
  ArrowRight,
  Camera,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  SkipForward,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PixelSpinner } from "@/components/ui/pixel-spinner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { MatrixSpinner } from "@/components/ui/matrix-spinner";
import { useAiVisionEnabled } from "@/hooks/useAiVisionEnabled";
import { useTranslation } from "@/hooks/useTranslation";
import {
  buildInvoiceFields,
  fetchInvoiceExtensionConfig,
  fetchInvoiceMonetaryConfig,
  isEmptyInvoiceTarget,
  parseInvoiceResult,
  resolveInvoiceRows,
  scoreInvoiceProduct,
  type ImportedInvoiceItem,
  type InvoiceMonetaryConfig,
  type InvoiceProduct,
  type InvoiceRow,
} from "@/lib/invoice";
import { runMedispeakOcr } from "@/lib/ocr/medispeak";
import {
  fillInvoiceRowsSequentially,
  markInvoiceRows,
  scrollToInvoiceRow,
} from "@/lib/ocr/invoice-highlights";

interface Props {
  facilityId: string;
  deliveryOrderId: string;
  form: {
    formState: { isSubmitting: boolean };
    getValues: (field: "items") => unknown[];
    setValue: (
      field: "items" | `items.${number}`,
      value: unknown[] | ImportedInvoiceItem,
      options: { shouldDirty: boolean; shouldValidate: boolean },
    ) => void;
  };
}

interface QueuedFile {
  file: File;
  url: string;
}

interface InvoiceWarning {
  message: string;
  row?: number;
  description?: string;
  details?: string[];
  targetIndex?: number;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isInvoiceFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

const INVOICE_ROW_LIMIT = 100;

export default function InvoiceOCR({
  facilityId,
  deliveryOrderId,
  form,
}: Props) {
  const { t } = useTranslation();
  const { enabled } = useAiVisionEnabled();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<QueuedFile[]>([]);
  const [preview, setPreview] = useState<QueuedFile | null>(null);
  const [warnings, setWarnings] = useState<InvoiceWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [matchingRow, setMatchingRow] = useState<number | null>(null);
  const [productSelections, setProductSelections] = useState<
    {
      row: InvoiceRow;
      candidates: InvoiceProduct[];
    }[]
  >([]);
  const pendingSelections = useRef(
    new Map<number, (product: InvoiceProduct | undefined) => void>(),
  );
  const [error, setError] = useState("");
  const [filled, setFilled] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const clearHighlights = useRef<(() => void) | null>(null);
  const clearWarningHighlight = useRef<(() => void) | undefined>(undefined);
  const cameraInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const isSubmitting = form.formState.isSubmitting;

  useEffect(() => {
    setPreview(null);
    const next = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviews(next);
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);

  useEffect(() => {
    const pending = pendingSelections.current;
    setFiles([]);
    setPreview(null);
    setWarnings([]);
    setError("");
    setFilled(0);
    setBusy(false);
    setIsFilling(false);
    setMatchingRow(null);
    setProductSelections([]);
    return () => {
      generation.current += 1;
      pending.forEach((resolve) => resolve(undefined));
      pending.clear();
      clearHighlights.current?.();
      clearHighlights.current = null;
      clearWarningHighlight.current?.();
      clearWarningHighlight.current = undefined;
    };
  }, [deliveryOrderId, facilityId]);

  useEffect(() => {
    if (!isSubmitting && enabled) return;
    generation.current += 1;
    pendingSelections.current.forEach((resolve) => resolve(undefined));
    pendingSelections.current.clear();
    setProductSelections([]);
    setBusy(false);
    setIsFilling(false);
    setMatchingRow(null);
  }, [isSubmitting, enabled]);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  const clearDraft = () => {
    generation.current += 1;
    clearWarningHighlight.current?.();
    clearWarningHighlight.current = undefined;
    pendingSelections.current.forEach((resolve) => resolve(undefined));
    pendingSelections.current.clear();
    setProductSelections([]);
    setBusy(false);
    setIsFilling(false);
    setMatchingRow(null);
    setWarnings([]);
    setError("");
    setFilled(0);
  };

  const addFiles = (incoming: File[]) => {
    if (incoming.some((file) => !isInvoiceFile(file))) {
      setError(t("upload_image_error"));
      return;
    }
    const replaceCompleted = filled > 0;
    clearDraft();
    setFiles((current) => {
      const next = replaceCompleted ? [] : [...current];
      for (const file of incoming) {
        if (!next.some((existing) => fileKey(existing) === fileKey(file)))
          next.push(file);
      }
      return next;
    });
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length) addFiles(selected);
    event.target.value = "";
  };

  const removeAt = (index: number) => {
    clearDraft();
    setPreview(null);
    setFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
  };

  const reset = () => {
    clearDraft();
    setFiles([]);
    setPreview(null);
  };

  const handleProductSelect = (
    row: number,
    product: InvoiceProduct | undefined,
  ) => {
    const resolve = pendingSelections.current.get(row);
    pendingSelections.current.delete(row);
    setProductSelections((current) =>
      current.filter((selection) => selection.row.row !== row),
    );
    resolve?.(product);
  };

  const extract = async () => {
    if (!files.length || isSubmitting || busy) return;
    const run = ++generation.current;
    setBusy(true);
    setIsFilling(false);
    setMatchingRow(null);
    setWarnings([]);
    setError("");
    setFilled(0);
    try {
      const result = await runMedispeakOcr(files, {
        facilityId,
        fields: buildInvoiceFields(INVOICE_ROW_LIMIT),
      });
      if (run !== generation.current) return;
      const parsed = parseInvoiceResult(result, INVOICE_ROW_LIMIT);
      const monetaryWarnings: string[] = [];
      const [facilityConfig, extensionConfig] = await Promise.all([
        fetchInvoiceMonetaryConfig(facilityId).catch(() => {
          monetaryWarnings.push(t("invoice_monetary_config_missing"));
          return {};
        }),
        fetchInvoiceExtensionConfig().catch(() => {
          monetaryWarnings.push(t("invoice_extension_config_missing"));
          return {};
        }),
      ]);
      const monetaryConfig: InvoiceMonetaryConfig = {
        ...facilityConfig,
        ...extensionConfig,
      };
      if (run !== generation.current) return;
      const resolved = await resolveInvoiceRows(
        parsed.rows,
        facilityId,
        monetaryConfig,
        {
          translate: t,
          onRow: setMatchingRow,
          isCancelled: () =>
            run !== generation.current ||
            form.formState.isSubmitting ||
            !enabled,
          selectProduct: (row, candidates) =>
            new Promise<InvoiceProduct | undefined>((resolve) => {
              pendingSelections.current.set(row.row, resolve);
              setProductSelections((current) => [
                ...current,
                { row, candidates },
              ]);
            }),
        },
      );
      if (!resolved || run !== generation.current) return;
      const { items, unmatched, issues } = resolved;
      if (!items.length) {
        setWarnings(unmatched.map((message) => ({ message })));
        setError(
          t(
            parsed.rows.length
              ? "invoice_no_products_matched"
              : "no_values_extracted",
          ),
        );
        return;
      }
      const current = form
        .getValues("items")
        .filter((item) => !isEmptyInvoiceTarget(item));
      if (form.formState.isSubmitting) {
        setError(t("invoice_form_submitting"));
        return;
      }
      setIsFilling(true);
      const stagedItems = items.map((item) => ({
        product_knowledge: item.product_knowledge,
        supplied_item_quantity: "",
        supplied_item_pack_quantity: 1,
        supplied_item_pack_size: 1,
        is_manually_edited: true,
        _is_inward_stock: true,
        extensions: {},
      }));
      form.setValue("items", [...current, ...stagedItems], {
        shouldDirty: true,
        shouldValidate: false,
      });
      clearHighlights.current?.();
      const scope = sectionRef.current?.parentElement;
      if (scope) {
        const marks = issues.map((issue) => ({
          index: current.length + issue.offset,
          attention: issue.attention,
          mrpIndex: monetaryConfig.instance_informational_codes?.findIndex(
            (code) => code.code === "mrp",
          ),
        }));
        const highlights = markInvoiceRows(scope, [], t("check_this"));
        clearHighlights.current = highlights;
        const completed = await fillInvoiceRowsSequentially(
          scope,
          marks,
          (index) =>
            form.setValue(`items.${index}`, items[index - current.length], {
              shouldDirty: true,
              shouldValidate: false,
            }),
          (mark) => {
            highlights.add(mark);
            setFilled(mark.index - current.length + 1);
          },
          () => run !== generation.current || form.formState.isSubmitting,
        );
        if (!completed) return;
      } else {
        form.setValue("items", [...current, ...items], {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
      const notes: InvoiceWarning[] = [
        ...[...monetaryWarnings, ...unmatched].map((message) => ({ message })),
        ...issues
          .filter((issue) => issue.details.length > 0)
          .map((issue) => ({
            message: t("invoice_row_attention", {
              row: current.length + issue.offset + 1,
              description: issue.description,
              details: issue.details.join("; "),
            }),
            row: current.length + issue.offset + 1,
            description: issue.description,
            details: issue.details,
            targetIndex: current.length + issue.offset,
          })),
      ];
      if (
        parsed.rowCount == null ||
        parsed.rowCount !== parsed.rows.length ||
        parsed.errors.length
      ) {
        notes.unshift({
          message: t("invoice_incomplete", {
            extracted: parsed.rows.length,
            total: parsed.rowCount ?? "?",
          }),
        });
      }
      setWarnings(notes);
      setFilled(items.length);
    } catch (cause) {
      if (run === generation.current)
        setError(
          cause instanceof Error ? cause.message : t("extraction_failed"),
        );
    } finally {
      if (run === generation.current) {
        setBusy(false);
        setIsFilling(false);
        setMatchingRow(null);
      }
    }
  };

  const warningGroups = [
    {
      title: t("invoice_notes"),
      entries: warnings.filter((warning) => warning.targetIndex == null),
    },
    {
      title: t("invoice_receipt_review"),
      entries: warnings.filter((warning) => warning.targetIndex != null),
    },
  ].filter((group) => group.entries.length > 0);

  if (!enabled) return null;
  const success = !busy && filled > 0 && !error;
  const staging = !busy && !success;

  return (
    <section
      ref={sectionRef}
      className="care-ai-vision-container space-y-3 -mx-3"
      aria-label={t("invoice_import")}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      {staging && files.length === 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-blue-900">
              {t("autofill_from")}
            </p>
            <p className="text-sm text-gray-800">
              {t("autofill_from_description")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="white"
              size="sm"
              className="gap-2 md:hidden"
              disabled={isSubmitting}
              onClick={() => cameraInput.current?.click()}
            >
              <Camera />
              {t("take_photo")}
            </Button>
            <Button
              type="button"
              variant="white"
              size="sm"
              className="gap-2"
              disabled={isSubmitting}
              onClick={() => fileInput.current?.click()}
            >
              <Upload />
              {t("upload_files")}
            </Button>
          </div>
        </div>
      )}
      {staging && files.length > 0 && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/70 p-4">
          <div>
            <p className="text-sm font-semibold text-blue-900">
              {t("docs_ready_to_autofill", { count: files.length })}
            </p>
            <p className="text-sm text-gray-800">
              {t("autofill_from_description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {previews.map((item, index) => (
                <div
                  key={fileKey(item.file)}
                  className="flex h-10 shrink-0 overflow-hidden rounded-md border border-gray-300 bg-white"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 min-w-10 shrink-0 rounded-none p-0"
                    title={item.file.name}
                    aria-label={item.file.name}
                    onClick={() => {
                      if (item.file.type.startsWith("image/")) setPreview(item);
                      else
                        window.open(item.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    {item.file.type.startsWith("image/") ? (
                      <img
                        src={item.url}
                        alt=""
                        className="size-10 object-cover hover:opacity-80"
                      />
                    ) : (
                      <FileText className="size-5 text-blue-600" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 w-8 min-w-8 shrink-0 rounded-none border-l border-gray-200 p-0 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                    title={t("remove_page")}
                    aria-label={t("remove_page")}
                    disabled={isSubmitting}
                    onClick={() => removeAt(index)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="white"
                size="sm"
                className="h-10 gap-2 md:hidden"
                disabled={isSubmitting}
                onClick={() => cameraInput.current?.click()}
              >
                <Camera />
                {t("take_photo")}
              </Button>
              <Button
                type="button"
                variant="white"
                size="sm"
                className="h-10 gap-2"
                disabled={isSubmitting}
                onClick={() => fileInput.current?.click()}
              >
                <Plus />
                {t("add_files")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="white"
                size="sm"
                disabled={isSubmitting}
                onClick={reset}
              >
                {t("discard")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-green-800 text-white hover:bg-green-900"
                disabled={isSubmitting}
                onClick={() => void extract()}
              >
                <Sparkles />
                {t("autofill_from_n_docs", { count: files.length })}
              </Button>
            </div>
          </div>
        </div>
      )}
      {busy && productSelections.length === 0 && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center gap-2 text-sm text-blue-500">
              <PixelSpinner
                name="braille"
                size="19"
                className="shrink-0 text-blue-800"
              />
              <span className="font-semibold text-blue-900">
                {isFilling
                  ? t("autofilling_fields")
                  : matchingRow == null
                    ? t("extracting_information")
                    : t("invoice_matching", { row: matchingRow })}
              </span>
            </div>
            <p className="text-sm text-blue-900 italic">
              {t("please_wait_while_we_fill")}
            </p>
          </div>
        </div>
      )}
      {busy && productSelections.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50/70">
          <ul className="max-h-96 divide-y divide-blue-200 overflow-y-auto">
            {productSelections.map((productSelection, index) => (
              <li
                key={productSelection.row.row}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs text-gray-600">
                    {t("invoice_select_product", {
                      row: productSelection.row.row,
                    })}
                  </p>
                  <p className="wrap-break-word text-sm font-medium text-gray-900">
                    {productSelection.row.description}
                  </p>
                </div>
                <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {productSelection.candidates.length > 1 ? (
                    <SelectPrimitive.Root
                      value=""
                      disabled={isSubmitting}
                      onValueChange={(slug) => {
                        const product = productSelection.candidates.find(
                          (candidate) => candidate.slug === slug,
                        );
                        if (product)
                          handleProductSelect(
                            productSelection.row.row,
                            product,
                          );
                      }}
                    >
                      <SelectPrimitive.Trigger asChild>
                        <Button
                          type="button"
                          variant="white"
                          size="sm"
                          autoFocus={index === 0}
                          className="h-8 w-full min-w-0 justify-between gap-2 text-left"
                          aria-label={`${t("invoice_select_product", { row: productSelection.row.row })}: ${productSelection.row.description}`}
                        >
                          <SelectPrimitive.Value
                            className="min-w-0 truncate"
                            placeholder={t("invoice_select_product", {
                              row: productSelection.row.row,
                            })}
                          />
                          <SelectPrimitive.Icon asChild>
                            <ChevronDown className="text-gray-500" />
                          </SelectPrimitive.Icon>
                        </Button>
                      </SelectPrimitive.Trigger>
                      <SelectPrimitive.Portal>
                        <div className="care-ai-vision-container">
                          <SelectPrimitive.Content
                            position="popper"
                            sideOffset={4}
                            className="z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-gray-200 bg-white text-gray-900 shadow-md"
                          >
                            <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center">
                              <ChevronUp className="size-4" />
                            </SelectPrimitive.ScrollUpButton>
                            <SelectPrimitive.Viewport className="max-h-64 p-1">
                              {productSelection.candidates.map((product) => (
                                <SelectPrimitive.Item
                                  key={product.slug}
                                  value={product.slug}
                                  className="min-h-8 cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-blue-50 data-highlighted:text-blue-900"
                                >
                                  <SelectPrimitive.ItemText>
                                    <span className="flex items-start justify-between gap-3">
                                      <span className="min-w-0 wrap-break-word">
                                        {product.name}
                                      </span>
                                      <span className="shrink-0 text-xs text-gray-500">
                                        {t("invoice_product_match", {
                                          percent: scoreInvoiceProduct(
                                            product,
                                            productSelection.row.description,
                                          ),
                                        })}
                                      </span>
                                    </span>
                                  </SelectPrimitive.ItemText>
                                </SelectPrimitive.Item>
                              ))}
                            </SelectPrimitive.Viewport>
                            <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center">
                              <ChevronDown className="size-4" />
                            </SelectPrimitive.ScrollDownButton>
                          </SelectPrimitive.Content>
                        </div>
                      </SelectPrimitive.Portal>
                    </SelectPrimitive.Root>
                  ) : (
                    <Button
                      type="button"
                      variant="white"
                      size="sm"
                      autoFocus={index === 0}
                      disabled={isSubmitting}
                      className="h-auto min-h-8 max-w-full justify-between gap-2 whitespace-normal px-2.5 py-1.5 text-left"
                      onClick={() =>
                        handleProductSelect(
                          productSelection.row.row,
                          productSelection.candidates[0],
                        )
                      }
                    >
                      <span className="min-w-0 wrap-break-word text-sm font-medium">
                        {productSelection.candidates[0]?.name}
                      </span>
                      <span className="shrink-0 text-xs font-normal text-gray-500">
                        {t("invoice_product_match", {
                          percent: scoreInvoiceProduct(
                            productSelection.candidates[0],
                            productSelection.row.description,
                          ),
                        })}
                      </span>
                      <ArrowRight className="text-blue-700" />
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-start-2 row-start-1 size-8 shrink-0 sm:col-start-3"
                  title={t("invoice_skip_row")}
                  aria-label={`${t("invoice_skip_row")}: ${productSelection.row.description}`}
                  disabled={isSubmitting}
                  onClick={() =>
                    handleProductSelect(productSelection.row.row, undefined)
                  }
                >
                  <SkipForward />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-blue-200 px-3 py-1">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <X />
              {t("invoice_cancel_import")}
            </Button>
          </div>
        </div>
      )}
      {success && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-green-600 bg-green-50 px-4 py-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex min-w-0 items-center gap-2">
            <MatrixSpinner
              name="spin-check"
              size="20"
              className="shrink-0 text-green-900"
            />
            <p className="text-sm font-medium text-green-900">
              {t("invoice_filled", { count: filled })}
            </p>
          </div>
          <div className="flex gap-2">
            <ButtonGroup className="md:hidden" aria-label={t("add_files")}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => cameraInput.current?.click()}
              >
                <Camera />
                {t("add_photo")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => fileInput.current?.click()}
              >
                <Plus />
                {t("add_files")}
              </Button>
            </ButtonGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
              disabled={isSubmitting}
              onClick={() => fileInput.current?.click()}
            >
              <Plus />
              {t("add_files")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={reset}
            >
              <X />
            </Button>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="alert" className="space-y-2 text-xs text-amber-900">
          {warningGroups.map((group) => (
            <div
              key={group.title}
              className="border-l-2 border-amber-500 bg-amber-50"
            >
              <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold">
                {group.title}
              </p>
              <ul className="divide-y divide-amber-200/70">
                {group.entries.map((warning, index) => (
                  <li key={index}>
                    {warning.targetIndex != null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-8 w-full items-center justify-between gap-2 whitespace-normal rounded-none px-2.5 py-1 text-left hover:bg-amber-100"
                        onClick={() => {
                          const scope = sectionRef.current?.parentElement;
                          if (!scope || warning.targetIndex == null) return;
                          clearWarningHighlight.current?.();
                          clearWarningHighlight.current = scrollToInvoiceRow(
                            scope,
                            warning.targetIndex,
                          );
                        }}
                      >
                        <span className="flex min-w-0 flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-baseline">
                          <span className="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-amber-950">
                            <span className="font-semibold">
                              {t("invoice_review_row", {
                                row: warning.row ?? "",
                              })}
                            </span>
                            <span className="min-w-0 wrap-break-word font-medium">
                              {warning.description}
                            </span>
                          </span>
                          <span className="flex flex-wrap gap-x-3 text-xs font-normal text-gray-700">
                            {warning.details?.map((detail, detailIndex) => (
                              <span
                                key={detailIndex}
                                className="wrap-break-word"
                              >
                                {detail}
                              </span>
                            ))}
                          </span>
                        </span>
                        <ArrowRight className="text-amber-700" />
                      </Button>
                    ) : (
                      <p className="wrap-break-word px-2.5 py-1.5 text-xs font-medium">
                        {warning.message}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-red-600"
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}
      {preview &&
        createPortal(
          <div className="care-ai-vision-container">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={preview.file.name}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setPreview(null)}
            >
              <Button
                type="button"
                variant="white"
                size="icon"
                className="absolute right-4 top-4 rounded-full"
                aria-label={t("done")}
                onClick={() => setPreview(null)}
              >
                <X />
              </Button>
              <img
                src={preview.url}
                alt={preview.file.name}
                className="max-h-[85vh] max-w-full rounded object-contain"
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
