import useAuthUser from "@/hooks/useAuthUser";
import {
  aiVisionFillSpeedAtomFor,
  type AiVisionFillSpeed,
} from "@/state/ai-vision-store";
import { useAtom } from "jotai";
import { useMemo } from "react";

const FILL_SPEED_DELAYS: Record<AiVisionFillSpeed, number> = {
  instant: 0,
  fast: 100,
  normal: 500,
};

/** Per-user AI Vision fill timing, shared by every form-filling workflow. */
export function useAiVisionFillSpeed() {
  const user = useAuthUser();
  const userKey = user.id ?? user.username;
  const fillSpeedAtom = useMemo(
    () => aiVisionFillSpeedAtomFor(userKey),
    [userKey],
  );
  const [fillSpeed, setFillSpeed] = useAtom(fillSpeedAtom);
  return {
    fillSpeed,
    setFillSpeed,
    fillDelayMs: FILL_SPEED_DELAYS[fillSpeed],
  };
}
