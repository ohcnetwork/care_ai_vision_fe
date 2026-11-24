/**
 * Best-effort facility id straight from the URL, for plugin slots that don't
 * receive it as a prop (e.g. `DiagnosticReportOverride`). Mirrors care_fe's
 * own `useCurrentFacility` path-parsing convention (`/facility/:facilityId/...`).
 */
export function resolveFacilityIdFromPath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const segments = window.location.pathname.split("/");
  if (segments[1] !== "facility") return undefined;
  const facilityId = segments[2];
  return facilityId && facilityId !== "undefined" && facilityId !== "null"
    ? facilityId
    : undefined;
}
