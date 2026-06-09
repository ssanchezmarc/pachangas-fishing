import { describe, expect, it } from "vitest";
import { FEPYC_AGGREGATION_PRESET } from "./types";
import { assignPlacings, individualRanking, type Participation } from "./ranking";

const AGG = FEPYC_AGGREGATION_PRESET;

function part(
  anglerId: string,
  sectorId: string,
  catchPoints: number,
  biggestCatchCm = 0,
  roundId = "r1",
): Participation {
  return { anglerId, roundId, sectorId, catchPoints, biggestCatchCm };
}

describe("assignPlacings", () => {
  it("orders by catch points DESC within the sector", () => {
    const r = assignPlacings([
      part("a", "s1", 100),
      part("b", "s1", 300),
      part("c", "s1", 200),
    ]);
    const byId = Object.fromEntries(r.map((x) => [x.anglerId, x.placing]));
    expect(byId).toEqual({ b: 1, c: 2, a: 3 });
  });

  it("shares the average of placings on a tie (2nd and 3rd → 2.5)", () => {
    const r = assignPlacings([
      part("a", "s1", 300),
      part("b", "s1", 200),
      part("c", "s1", 200),
      part("d", "s1", 100),
    ]);
    const byId = Object.fromEntries(r.map((x) => [x.anglerId, x.placing]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(2.5);
    expect(byId.c).toBe(2.5);
    expect(byId.d).toBe(4);
  });

  it("separates by sector and by round", () => {
    const r = assignPlacings([part("a", "s1", 100), part("b", "s2", 100)]);
    // each is 1st of their own sector
    expect(r.every((x) => x.placing === 1)).toBe(true);
  });

  it("does not depend on input order (reproducible)", () => {
    const base = [part("a", "s1", 100), part("b", "s1", 300), part("c", "s1", 200)];
    const a = assignPlacings(base);
    const b = assignPlacings([...base].reverse());
    const norm = (xs: typeof a) => Object.fromEntries(xs.map((x) => [x.anglerId, x.placing]));
    expect(norm(a)).toEqual(norm(b));
  });
});

describe("individualRanking", () => {
  it("lowest sum of placings wins (multi-sector)", () => {
    // angler who is 1st in both rounds vs one who is 2nd in both
    const ps: Participation[] = [
      part("winner", "s1", 500, 30, "r1"),
      part("winner", "s2", 500, 30, "r2"),
      part("other", "s1", 100, 20, "r1"),
      part("other", "s2", 100, 20, "r2"),
    ];
    const c = individualRanking(ps, AGG);
    expect(c[0].anglerId).toBe("winner");
    expect(c[0].placingsSum).toBe(2);
    expect(c[1].anglerId).toBe("other");
    expect(c[1].placingsSum).toBe(4);
  });

  it("final tiebreak by total catch points", () => {
    // two anglers with the same sum of placings (both 1st and 2nd crossed)
    const ps: Participation[] = [
      part("x", "s1", 300, 25, "r1"), // 1st
      part("x", "s1", 100, 22, "r2"), // 2nd
      part("y", "s1", 200, 24, "r1"), // 2nd
      part("y", "s1", 200, 24, "r2"), // 1st
    ];
    const c = individualRanking(ps, AGG);
    // placings sum: x = 1+2 = 3 ; y = 2+1 = 3 → tie
    expect(c[0].placingsSum).toBe(3);
    expect(c[1].placingsSum).toBe(3);
    // x: 400 catch points ; y: 400 → still tied on points → biggest catch
    // x biggestCatch 25 > y 24 → x wins
    expect(c[0].anglerId).toBe("x");
  });

  it("final tiebreak by catch points when they differ", () => {
    const ps: Participation[] = [
      part("x", "s1", 300, 20, "r1"),
      part("x", "s1", 100, 20, "r2"),
      part("y", "s1", 250, 30, "r1"),
      part("y", "s1", 250, 30, "r2"),
    ];
    const c = individualRanking(ps, AGG);
    // x: placings 1+2=3, points 400 ; y: placings 2+1=3, points 500
    // placings tie → higher points wins → y ahead despite its catch
    expect(c[0].anglerId).toBe("y");
  });

  it("a full tie shares the position", () => {
    const ps: Participation[] = [
      part("a", "s1", 200, 25, "r1"),
      part("b", "s2", 200, 25, "r1"),
    ];
    const c = individualRanking(ps, AGG);
    // both 1st of their sector, same points and same biggest catch → full tie
    expect(c[0].position).toBe(1);
    expect(c[1].position).toBe(1);
  });
});
