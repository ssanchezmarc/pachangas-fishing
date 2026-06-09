import { describe, expect, it } from "vitest";
import {
  allowsEditing,
  canTransition,
  possibleTransitions,
  appealsWindowOpen,
} from "./round-status";

describe("round state machine", () => {
  it("open only goes to provisional", () => {
    expect(possibleTransitions("open")).toEqual(["provisional"]);
    expect(canTransition("open", "provisional")).toBe(true);
    expect(canTransition("open", "final")).toBe(false);
  });

  it("provisional goes to final", () => {
    expect(canTransition("provisional", "final")).toBe(true);
  });

  it("final is immutable: no transition nor edit", () => {
    expect(possibleTransitions("final")).toEqual([]);
    expect(canTransition("final", "provisional")).toBe(false);
    expect(allowsEditing("final")).toBe(false);
  });

  it("editing is allowed except in final", () => {
    expect(allowsEditing("open")).toBe(true);
    expect(allowsEditing("provisional")).toBe(true);
    expect(allowsEditing("final")).toBe(false);
  });

  it("appeals window open in provisional, not in open nor final", () => {
    expect(appealsWindowOpen("open")).toBe(false);
    expect(appealsWindowOpen("provisional")).toBe(true);
    expect(appealsWindowOpen("final")).toBe(false);
  });
});
