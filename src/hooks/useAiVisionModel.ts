import useAuthUser from "@/hooks/useAuthUser";
import {
  aiVisionModelAtomFor,
  fetchAiVisionModelPreference,
  modelSyncedForAtom,
  setAiVisionModelPreference,
} from "@/state/ai-vision-store";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

/**
 * User-level "which OpenAI model to use for direct vision OCR" setting.
 * Same hydrate-from-server-then-cache-locally pattern as
 * `useAiVisionEnabled`. Test/openai-direct-vision branch only.
 */
export function useAiVisionModel() {
  const user = useAuthUser();
  const userKey = user.id ?? user.username;
  const modelAtom = useMemo(() => aiVisionModelAtomFor(userKey), [userKey]);
  const [model, setModel] = useAtom(modelAtom);
  const [syncedFor, setSyncedFor] = useAtom(modelSyncedForAtom);

  useEffect(() => {
    if (syncedFor === userKey) return;
    let cancelled = false;
    fetchAiVisionModelPreference().then((serverValue) => {
      if (cancelled) return;
      setModel(serverValue);
      setSyncedFor(userKey);
    });
    return () => {
      cancelled = true;
    };
  }, [userKey, syncedFor, setModel, setSyncedFor]);

  const setModelPreference = useCallback(
    (value: string) => {
      setModel(value);
      setAiVisionModelPreference(value);
    },
    [setModel],
  );

  return { model, setModel: setModelPreference };
}
