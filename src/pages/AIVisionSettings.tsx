import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAiVisionEnabled } from "@/hooks/useAiVisionEnabled";
import { useAiVisionModel } from "@/hooks/useAiVisionModel";
import { useHasFacilityPermission } from "@/hooks/useFacilityPermission";
import { useTranslation } from "@/hooks/useTranslation";
import { OPENAI_VISION_MODELS } from "@/state/ai-vision-store";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function AIVisionSettings() {
  const { t } = useTranslation();
  const { hasPermission, isLoading: isPermissionLoading } =
    useHasFacilityPermission("can_use_filly");
  const { enabled, setEnabled } = useAiVisionEnabled();
  const { model, setModel } = useAiVisionModel();

  return (
    <div className="care-ai-vision-container mx-auto max-w-3xl py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">{t("ai_vision_settings")}</h1>

      {isPermissionLoading ? (
        <Card>
          <CardContent className="flex justify-center py-5">
            <Loader2 className="size-6 animate-spin text-gray-400" />
          </CardContent>
        </Card>
      ) : !hasPermission ? (
        <Card>
          <CardContent className="py-5 text-sm text-muted-foreground">
            {t("no_permission_ai_vision")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {enabled ? (
                <Eye className="h-5 w-5 text-green-500" />
              ) : (
                <EyeOff className="h-5 w-5 text-gray-400" />
              )}
              {t("ocr_form_fill")}
              <Badge
                className={
                  enabled
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                }
              >
                {enabled ? t("enable") : t("disable")}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t("ai_vision_settings_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {enabled ? t("plugin_enabled") : t("plugin_disabled")}
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </CardContent>
          {enabled && (
            <CardContent className="flex items-center justify-between border-t pt-4">
              <div>
                <div className="text-sm font-medium">
                  {t("ai_vision_model_label")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t("ai_vision_model_description")}
                </div>
              </div>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENAI_VISION_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
