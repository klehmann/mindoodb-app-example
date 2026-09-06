import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  BREAKOUT_ORIGIN,
  buildBreakoutUrl,
  crossBundlePath,
  describeExpectation,
  formatProbeError,
  ISOLATION_PROBES,
  isolationProbe,
  OTHER_BUNDLE_ID,
  batchProbes,
  runIsolationProbe,
  safeProbes,
  sessionEndingProbes,
  summarizeIsolationResults,
  type IsolationProbeResult,
} from "@/features/isolation/lib/isolationProbes";

/**
 * Minimal RTCPeerConnection stand-in — jsdom has none. Emits the given candidate
 * strings as soon as the offer is applied; a null entry is the end-of-gathering
 * signal the browser sends, and without one the probe would sit out its timeout.
 */
function stubPeerConnection(candidates: (string | null)[]) {
  const listeners = new Set<(event: { candidate: unknown }) => void>();
  const connection = {
    createDataChannel: vi.fn(),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "" }),
    close: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: (event: { candidate: unknown }) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: { candidate: unknown }) => void) => {
        listeners.delete(listener);
      },
    ),
    setLocalDescription: vi.fn(async () => {
      for (const candidate of candidates) {
        for (const listener of [...listeners]) {
          // `type` left undefined on purpose: exercises the SDP-string fallback.
          listener({ candidate: candidate === null ? null : { candidate } });
        }
      }
    }),
  };
  // A plain function, not an arrow: the probe calls this with `new`.
  vi.stubGlobal(
    "RTCPeerConnection",
    vi.fn(function () {
      return connection;
    }),
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return connection;
}

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

  it("keeps traffic-sending probes listed but out of the batch run", () => {
    const safe = safeProbes();
    const batch = batchProbes();

    // Still rendered and runnable on their own...
    expect(safe.map((probe) => probe.id)).toEqual(
      expect.arrayContaining(["webrtc", "dns-prefetch"]),
    );
    // ...but one click on "run all" must not reach a third-party server.
    expect(batch.map((probe) => probe.id)).not.toContain("webrtc");
    expect(batch.map((probe) => probe.id)).not.toContain("dns-prefetch");
    expect(batch.every((probe) => !probe.sendsRealTraffic)).toBe(true);
  });

  it("tells the truth about external mode instead of promising containment", () => {
    const probe = isolationProbe("self-navigation");

    expect(describeExpectation(probe, "hosted")).toBe(probe.hostedExpectation);
    expect(describeExpectation(probe, "external")).toContain("expect this to succeed");
  });

  it("reports an escape once the STUN server reflects an address back", async () => {
    const connection = stubPeerConnection([
      "candidate:1 1 udp 1686052607 203.0.113.7 54321 typ srflx raddr 0.0.0.0 rport 0",
    ]);

    const result = await runIsolationProbe("webrtc");

    expect(result.outcome).toBe("escaped");
    expect(result.detail).toContain("srflx");
    // The reflected address is the caller's public IP — never put it on screen.
    expect(result.detail).not.toContain("203.0.113.7");
    expect(connection.close).toHaveBeenCalled();
  });

  it("stays unclear when only local candidates turn up", async () => {
    // Host candidates are invented locally, so they prove no packet went out.
    stubPeerConnection(["candidate:2 1 udp 2130706431 192.168.1.4 49152 typ host", null]);

    const result = await runIsolationProbe("webrtc");

    expect(result.outcome).toBe("inconclusive");
    expect(result.detail).toContain("not Haven containing anything");
  });

  it("names the hostnames to look for when no policy stops a resource hint", async () => {
    const result = await runIsolationProbe("dns-prefetch");

    // jsdom enforces no CSP, which is the same shape as a browser that has no
    // directive for resource hints — exactly the case worth reporting on.
    expect(result.outcome).toBe("inconclusive");
    expect(result.detail).toContain("dns-prefetch → stolen-");
    expect(result.detail).toContain("preconnect → stolen-");
    expect(result.detail).toContain("mindoodb-apprunner.com");
  });

  it("invents a fresh hostname per run so the DNS cache cannot mask the leak", async () => {
    const [first, second] = await Promise.all([
      runIsolationProbe("dns-prefetch"),
      runIsolationProbe("dns-prefetch"),
    ]);

    expect(first.detail).not.toBe(second.detail);
  });

  it("leaves no hint elements behind in the document", async () => {
    await runIsolationProbe("dns-prefetch");

    expect(document.head.querySelectorAll("link[rel='dns-prefetch']")).toHaveLength(0);
    expect(document.head.querySelectorAll("link[rel='preconnect']")).toHaveLength(0);
  });

  it("counts outcomes for the summary badge", () => {
    expect(
      summarizeIsolationResults([
        result("popup", "contained"),
        result("haven-dom", "contained"),
        result("webrtc", "inconclusive"),
        result("app-storage", "escaped"),
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
