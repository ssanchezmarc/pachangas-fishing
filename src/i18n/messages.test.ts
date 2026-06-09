import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/** Flattens a nested message object into dotted keys. */
function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object"
      ? flattenKeys(v as Record<string, unknown>, key)
      : [key];
  });
}

describe("message catalogs (issue 14)", () => {
  const enKeys = flattenKeys(en).sort();
  const esKeys = flattenKeys(es).sort();

  it("English and Spanish have the exact same key set (no missing translations)", () => {
    const missingInEs = enKeys.filter((k) => !esKeys.includes(k));
    const missingInEn = esKeys.filter((k) => !enKeys.includes(k));
    expect(missingInEs, "keys missing in es.json").toEqual([]);
    expect(missingInEn, "keys missing in en.json").toEqual([]);
  });

  it("covers the validation issue codes used by the domain", () => {
    for (const code of [
      "signalsMismatch",
      "legalCatchesMismatch",
      "undersizedMismatch",
      "biggestCatchMismatch",
      "lotNotInRoster",
      "lowLotConfidence",
      "lowCatchesConfidence",
      "lowTotalsConfidence",
    ]) {
      expect(enKeys).toContain(`issue.${code}`);
      expect(esKeys).toContain(`issue.${code}`);
    }
  });
});
