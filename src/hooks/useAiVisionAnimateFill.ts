import useAuthUser from "@/hooks/useAuthUser";
import { aiVisionAnimateFillAtomFor } from "@/state/ai-vision-store";
import { useAtom } from "jotai";
import { useMemo } from "react";

/** Whether invoice rows fill one by one with animation; off by default (all rows fill at once). */
export function useAiVisionAnimateFill() {
  const user = useAuthUser();
  const userKey = user.id ?? user.username;
  const animateAtom = useMemo(
    () => aiVisionAnimateFillAtomFor(userKey),
    [userKey],
  );
  const [animateFill, setAnimateFill] = useAtom(animateAtom);
  return { animateFill, setAnimateFill };
}
