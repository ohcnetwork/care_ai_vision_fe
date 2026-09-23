import { getHeaders } from "@/lib/request";
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

const STORAGE_KEY_PREFIX = "care_ai_vision.enabled";
const PREFERENCE_KEY = "care_ai_vision";
const PREFERENCE_VERSION = "1.0";

/**
 * Local atom backed by localStorage — used as a per-device cache.
 * `useAiVisionEnabled` hydrates this from the server so a new device
 * still respects the user-level preference.
 */
export function aiVisionEnabledAtomFor(userId: string) {
  return atomWithStorage<boolean>(
    `${STORAGE_KEY_PREFIX}.${userId}`,
    false,
    createJSONStorage(() => localStorage),
  );
}

/** Fetch the AI Vision preference from the server (via getcurrentuser). */
export async function fetchAiVisionPreference(): Promise<boolean> {
  try {
    const res = await fetch(
      new URL("/api/v1/users/getcurrentuser/", window.CARE_API_URL).toString(),
      { headers: getHeaders() },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.preferences?.[PREFERENCE_KEY]?.enabled === true;
  } catch {
    return false;
  }
}

/** Persist the AI Vision preference to the server. */
export async function setAiVisionPreference(enabled: boolean): Promise<void> {
  await fetch(
    new URL("/api/v1/users/set_preferences/", window.CARE_API_URL).toString(),
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        preference: PREFERENCE_KEY,
        version: PREFERENCE_VERSION,
        value: { enabled },
      }),
    },
  );
}

/** User key whose server preference has already been hydrated this session. */
export const preferencesSyncedForAtom = atom<string | null>(null);

// --- OpenAI direct-vision model preference (test/openai-direct-vision branch) ---

const MODEL_STORAGE_KEY_PREFIX = "care_ai_vision.model";
const MODEL_PREFERENCE_KEY = "care_ai_vision_model";
const MODEL_PREFERENCE_VERSION = "1.0";

export const DEFAULT_OPENAI_VISION_MODEL = "gpt-6-luna";

/** OpenAI models that support vision input + structured (json_schema) output. */
export const OPENAI_VISION_MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { value: "o4-mini", label: "o4-mini" },
  { value: "gpt-6-luna", label: "GPT-6 Luna" },
] as const;

/** Local atom backed by localStorage — same per-device-cache pattern as `enabled`. */
export function aiVisionModelAtomFor(userId: string) {
  return atomWithStorage<string>(
    `${MODEL_STORAGE_KEY_PREFIX}.${userId}`,
    DEFAULT_OPENAI_VISION_MODEL,
    createJSONStorage(() => localStorage),
  );
}

/** Fetch the chosen OpenAI vision model from the server (via getcurrentuser). */
export async function fetchAiVisionModelPreference(): Promise<string> {
  try {
    const res = await fetch(
      new URL("/api/v1/users/getcurrentuser/", window.CARE_API_URL).toString(),
      { headers: getHeaders() },
    );
    if (!res.ok) return DEFAULT_OPENAI_VISION_MODEL;
    const data = await res.json();
    return (
      data?.preferences?.[MODEL_PREFERENCE_KEY]?.model ||
      DEFAULT_OPENAI_VISION_MODEL
    );
  } catch {
    return DEFAULT_OPENAI_VISION_MODEL;
  }
}

/** Persist the chosen OpenAI vision model to the server. */
export async function setAiVisionModelPreference(model: string): Promise<void> {
  await fetch(
    new URL("/api/v1/users/set_preferences/", window.CARE_API_URL).toString(),
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        preference: MODEL_PREFERENCE_KEY,
        version: MODEL_PREFERENCE_VERSION,
        value: { model },
      }),
    },
  );
}

/** User key whose model preference has already been hydrated this session. */
export const modelSyncedForAtom = atom<string | null>(null);
