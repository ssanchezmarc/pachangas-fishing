import { describe, expect, it } from "vitest";
import { canResolveClaim, isResolution } from "./claim";

describe("claim resolution (issue 25)", () => {
  it("an open claim can be resolved or rejected", () => {
    expect(canResolveClaim("open")).toBe(true);
  });

  it("a resolved or rejected claim is terminal", () => {
    expect(canResolveClaim("resolved")).toBe(false);
    expect(canResolveClaim("rejected")).toBe(false);
  });

  it("recognises the valid resolutions", () => {
    expect(isResolution("resolved")).toBe(true);
    expect(isResolution("rejected")).toBe(true);
    expect(isResolution("open")).toBe(false);
    expect(isResolution("whatever")).toBe(false);
  });
});
