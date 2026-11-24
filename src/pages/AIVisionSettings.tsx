import { Eye, EyeOff, FileScan, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAiVisionEnabled } from "@/hooks/useAiVisionEnabled";
import { useAiVisionFillSpeed } from "@/hooks/useAiVisionFillSpeed";
import { useHasFacilityPermission } from "@/hooks/useFacilityPermission";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

const fillSpeedOptions = [
  { value: "instant", label: "instant" },
  { value: "fast", label: "fast_100_ms" },
  { value: "normal", label: "normal_500_ms" },
] as const;

export default function AIVisionSettings() {
  const { t } = useTranslation();
  const {
    hasFacility,
    hasPermission,
    isLoading: isPermissionLoading,
  } = useHasFacilityPermission("can_use_filly");
  const { enabled, setEnabled } = useAiVisionEnabled();
  const { fillSpeed, setFillSpeed } = useAiVisionFillSpeed();

  return (
    <div className="care-ai-vision-container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <FileScan className="size-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t("ai_vision_settings")}
        </h1>
      </div>

      {isPermissionLoading || (hasFacility && !hasPermission) ? (
        <section className="flex flex-col gap-5 sm:flex-row">
          <div className="sm:w-1/4">
            <div className="my-1 text-sm leading-5">
              <p className="mb-2 font-semibold">{t("ocr_form_fill")}</p>
              <p className="text-secondary-600">
                {t("ai_vision_settings_description")}
              </p>
            </div>
          </div>
          <div className="sm:w-3/4">
            <div className="flex h-full items-center overflow-visible rounded-lg bg-white px-4 py-5 shadow-sm sm:px-6">
              {isPermissionLoading ? (
                <Loader2 className="size-6 shrink-0 animate-spin text-gray-400" />
              ) : (
                <p className="text-sm text-secondary-600">
                  {t("no_permission_ai_vision")}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-5 sm:flex-row">
            <div className="sm:w-1/4">
              <div className="my-1 text-sm leading-5">
                <p className="mb-2 font-semibold">{t("ocr_form_fill")}</p>
                <p className="text-secondary-600">
                  {t("ai_vision_settings_description")}
                </p>
              </div>
            </div>
            <div className="sm:w-3/4">
              <div className="flex h-full items-center overflow-visible rounded-lg bg-white px-4 py-5 shadow-sm sm:px-6">
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        enabled
                          ? "bg-primary-100 text-primary-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {enabled ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </span>
                    <p className="text-sm font-medium text-gray-900">
                      {enabled ? t("plugin_enabled") : t("plugin_disabled")}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    aria-label={t("ocr_form_fill")}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 flex flex-col gap-5 sm:flex-row">
            <div className="sm:w-1/4">
              <div className="my-1 text-sm leading-5">
                <p className="mb-2 font-semibold">
                  {t("field_filling_speed")}
                </p>
                <p className="text-secondary-600">
                  {t("field_filling_speed_description")}
                </p>
              </div>
            </div>
            <div className="sm:w-3/4">
              <div className="flex h-full items-center overflow-visible rounded-lg bg-white px-4 py-5 shadow-sm sm:px-6">
                <div
                  className="flex w-full flex-col gap-2 sm:flex-row sm:gap-3"
                  role="group"
                  aria-label={t("field_filling_speed")}
                >
                  {fillSpeedOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      aria-pressed={fillSpeed === option.value}
                      onClick={() => setFillSpeed(option.value)}
                      className={cn(
                        "h-auto min-h-16 flex-1 justify-start gap-3 whitespace-normal rounded-lg px-4 py-4 text-left",
                        fillSpeed === option.value
                          ? "border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                          fillSpeed === option.value
                            ? "border-primary-700"
                            : "border-gray-300",
                        )}
                      >
                        {fillSpeed === option.value && (
                          <span className="size-2.5 rounded-full bg-primary-700" />
                        )}
                      </span>
                      {t(option.label)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
