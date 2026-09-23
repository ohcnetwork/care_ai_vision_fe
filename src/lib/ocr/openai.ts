import { readPluginConfig } from "@/lib/plugin-config";
import { MedispeakFieldSpec } from "./medispeak";

/**
 * TEST-ONLY alternative to medispeak.ts: calls the OpenAI Chat Completions
 * API directly from the browser, in a single request — no
 * session/upload/commit/poll pipeline, the model returns the structured
 * result right away.
 *
 * SECURITY WARNING (do not ship this to production): unlike the Medispeak
 * flow, which mints a short-lived, session-scoped token server-side so the
 * browser never holds the account secret, this file sends the raw
 * `Authorization: Bearer <OPENAI_API_KEY>` header directly from the client.
 * Any user of a deployment wired up this way can read that key out of
 * DevTools' network tab or the plugin config exposed on `window`. Only use
 * this with a throwaway/low-quota test key, never a production OpenAI key.
 */

export class OpenAiApiError extends Error {}

const DEFAULT_MODEL = "gpt-4o-mini";
const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

interface CreateParams {
  facilityId?: string | null;
  fields: MedispeakFieldSpec[];
}

/**
 * The OpenAI API key. Resolved at call time, in order:
 *
 *   1. `OPENAI_API_KEY` in this plugin's config, set when it is registered
 *      in CARE — changing it needs no rebuild.
 *   2. `REACT_OPENAI_API_KEY`, baked in at build time. Local dev only.
 *
 * Never cache this at module scope: care_fe publishes the plugin config
 * from an effect after the configs load, so an import-time read is empty.
 */
function requireOpenAiApiKey(): string {
  const configured =
    readPluginConfig("OPENAI_API_KEY") ??
    readPluginConfig("REACT_OPENAI_API_KEY") ??
    (import.meta.env.REACT_OPENAI_API_KEY || "").toString();

  const apiKey = configured.trim();
  if (!apiKey) {
    throw new Error(
      'OpenAI API key is not configured. Set "OPENAI_API_KEY" in this ' +
        "plugin's config in CARE (Admin → plugins), or REACT_OPENAI_API_KEY " +
        "in .env for local development (requires a rebuild). Use a " +
        "throwaway/test key only — it is sent directly from the browser.",
    );
  }
  return apiKey;
}

function fieldToJsonSchema(field: MedispeakFieldSpec): Record<string, unknown> {
  switch (field.type) {
    case "number":
      return { type: ["number", "null"] };
    case "boolean":
      return { type: ["boolean", "null"] };
    case "single_select":
      return { type: ["string", "null"], enum: [...(field.enum ?? []), null] };
    case "multi_select":
      return {
        type: "array",
        items: { type: "string", enum: field.enum ?? [] },
      };
    case "string":
    default:
      return { type: ["string", "null"] };
  }
}

function buildJsonSchema(fields: MedispeakFieldSpec[]) {
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    properties[field.key] = {
      ...fieldToJsonSchema(field),
      description: [field.label, field.description].filter(Boolean).join(" — "),
    };
  }
  return {
    name: "extraction",
    strict: true,
    schema: {
      type: "object",
      properties,
      required: fields.map((f) => f.key),
      additionalProperties: false,
    },
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts structured fields from one or more images/PDFs in a single
 * OpenAI vision call — the direct-to-result counterpart of
 * `runMedispeakOcr`. Same `fields`-in, `Record<key, value>`-out shape, so
 * it's a drop-in replacement in care-ai.ts.
 */
export async function runOpenAiVisionOcr(
  files: File | File[],
  params: CreateParams,
  options?: { model?: string; onTranscript?: (text: string) => void },
): Promise<Record<string, unknown>> {
  const documents = Array.isArray(files) ? files : [files];
  if (!documents.length) {
    throw new Error("No documents to upload");
  }

  const apiKey = requireOpenAiApiKey();
  const model = options?.model || DEFAULT_MODEL;
  const imageDataUrls = await Promise.all(documents.map(fileToDataUrl));

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You extract structured data from the attached document image(s) " +
            "for a healthcare records form. Only fill a field if it is " +
            "clearly visible; otherwise leave it null. Return only the " +
            "requested fields, nothing else.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the requested fields from this document.",
            },
            ...imageDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: buildJsonSchema(params.fields),
      },
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new OpenAiApiError(
      data?.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenAiApiError("OpenAI returned no extraction result");
  }
  options?.onTranscript?.(content);
  return JSON.parse(content) as Record<string, unknown>;
}
