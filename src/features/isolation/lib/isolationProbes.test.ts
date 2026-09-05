import { describe, expect, it } from "vitest";

import {
  BREAKOUT_ORIGIN,
  buildBreakoutUrl,
  crossBundlePath,
  describeExpectation,
  formatProbeError,
  ISOLATION_PROBES,
  isolationProbe,
  OTHER_BUNDLE_ID,
  safeProbes,
  sessionEndingProbes,
  summarizeIsolationResults,
  type IsolationProbeResult,
} from "@/features/isolation/lib/isolationProbes";

function result(
  id: IsolationProbeResult["id"],
  outcome: IsolationProbeResult["outcome"],
): IsolationProbeResult {
  return { id, outcome, detail: "", elapsedMs: 1 };
}

describe("isolation probes", () => {
  it("carries the exfiltration payload in the breakout URL", () => {
    // A navigation-based leak needs no response: whatever is in the query
    // string has already reached the other origin.
    const url = new URL(buildBreakoutUrl("mapped-database-contents"));
    expect(url.origin).toBe(BREAKOUT_ORIGIN);
    expect(url.searchParams.get("stolen")).toBe("mapped-database-contents");
  });

  it("guesses a sibling bundle with a relative path", () => {
    // The app knows neither Haven's origin nor its own bundle id, so `..` from
    // the bundle prefix is the guess an attacker can actually make.
    expect(crossBundlePath()).toBe(`../${OTHER_BUNDLE_ID}/index.html`);
    expect(crossBundlePath("app.js")).toBe(`../${OTHER_BUNDLE_ID}/app.js`);
  });

  it("keeps session-ending probes out of the safe set", () => {
    const safe = safeProbes();
    const destructive = sessionEndingProbes();

    expect(safe.length + destructive.length).toBe(ISOLATION_PROBES.length);
    expect(safe.every((probe) => !probe.endsSession)).toBe(true);
    expect(destructive.map((probe) => probe.id)).toEqual([
      "self-navigation",
      "cross-bundle-navigation",
      "top-navigation",
      "parent-navigation",
    ]);
  });

  it("tells the truth about external mode instead of promising containment", () => {
    const probe = isolationProbe("self-navigation");

    expect(describeExpectation(probe, "hosted")).toBe(probe.hostedExpectation);
    expect(describeExpectation(probe, "external")).toContain("expect this to succeed");
  });

  it("counts outcomes for the summary badge", () => {
    expect(
      summarizeIsolationResults([
        result("popup", "contained"),
        result("parent-dom", "contained"),
        result("webrtc", "inconclusive"),
        result("opaque-storage", "escaped"),
      ]),
    ).toEqual({ contained: 2, escaped: 1, inconclusive: 1 });
  });

  it("formats DOMException the way the browser names it", () => {
    expect(formatProbeError(new DOMException("blocked a frame", "SecurityError"))).toBe(
      "SecurityError: blocked a frame",
    );
    expect(formatProbeError(new TypeError("Failed to fetch"))).toBe("TypeError: Failed to fetch");
    expect(formatProbeError("plain string")).toBe("plain string");
  });

  it("rejects an unknown probe id", () => {
    // @ts-expect-error deliberately invalid id
    expect(() => isolationProbe("nope")).toThrow(/Unknown isolation probe/);
  });
});
