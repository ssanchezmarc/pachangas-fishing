/**
 * Issue 50 — A sector is identified by three fields: river + venue (escenario/coto)
 * + sector name. This module formats that triple into a single human label, pure
 * and shared by the loaders and the UI.
 *
 * Only the non-empty parts are joined (river/venue default to '' and may be blank),
 * so a sector that only has a name renders as just its name.
 */
export interface SectorParts {
  river?: string | null;
  venue?: string | null;
  name: string;
}

/** "Río · Escenario · Sector", skipping blank parts. */
export function sectorLabel(s: SectorParts): string {
  return [s.river, s.venue, s.name]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" · ");
}
