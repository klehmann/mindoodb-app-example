export const NETWORK_PRESET_ALLOWED =
  "https://api.open-meteo.com/v1/forecast?latitude=50.11&longitude=8.68&current=temperature_2m";
export const NETWORK_PRESET_BLOCKED = "https://httpbin.org/get";
export const NETWORK_PRESET_BLOCKED_IMAGE = "https://httpbin.org/image/png";

export type NetworkProbeMethod = "fetch" | "xhr" | "img";

export interface NetworkProbeResult {
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  bodyText: string;
  imageUrl: string | null;
  error: string | null;
  /**
   * The probe failed but cannot say whether the allowlist caused it.
   *
   * An `<img>` reports one undifferentiated `error` event, so "the host is not
   * allowlisted" and "the bytes are not an image" look identical from here.
   * Claiming `blocked` in that case would make the demo assert containment it
   * did not observe.
   */
  inconclusive?: boolean;
}

export function resolveProbeUrl(url: string, method: NetworkProbeMethod): string {
  const trimmed = url.trim();
  if (method === "img" && trimmed === NETWORK_PRESET_BLOCKED) {
    return NETWORK_PRESET_BLOCKED_IMAGE;
  }
  return trimmed;
}

function elapsedSince(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function truncateBody(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

export async function probeWithFetch(url: string): Promise<NetworkProbeResult> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url);
    const bodyText = truncateBody(await response.text());
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: elapsedSince(startedAt),
      bodyText,
      imageUrl: null,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      elapsedMs: elapsedSince(startedAt),
      bodyText: "",
      imageUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function probeWithXhr(url: string): Promise<NetworkProbeResult> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.addEventListener("load", () => {
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        elapsedMs: elapsedSince(startedAt),
        bodyText: truncateBody(request.responseText ?? ""),
        imageUrl: null,
        error: request.status >= 200 && request.status < 300 ? null : `HTTP ${request.status}`,
      });
    });
    request.addEventListener("error", () => {
      resolve({
        ok: false,
        status: request.status || null,
        elapsedMs: elapsedSince(startedAt),
        bodyText: "",
        imageUrl: null,
        error: "Network error",
      });
    });
    request.addEventListener("abort", () => {
      resolve({
        ok: false,
        status: null,
        elapsedMs: elapsedSince(startedAt),
        bodyText: "",
        imageUrl: null,
        error: "Request aborted",
      });
    });
    request.open("GET", url);
    request.send();
  });
}

/**
 * @param knownImage Whether this URL is known to serve image bytes. Only then
 *   does a failure isolate the allowlist as the cause.
 */
export function probeWithImage(url: string, knownImage = false): Promise<NetworkProbeResult> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({
        ok: true,
        status: null,
        elapsedMs: elapsedSince(startedAt),
        bodyText: "",
        imageUrl: url,
        error: null,
      });
    });
    image.addEventListener("error", () => {
      resolve({
        ok: false,
        status: null,
        elapsedMs: elapsedSince(startedAt),
        bodyText: "",
        imageUrl: null,
        error: knownImage
          ? "Image failed to load"
          : "Image failed to load — but this URL is not known to serve an image. "
            + "An <img> renders image bytes and nothing else, so a JSON or HTML "
            + "endpoint fails here even when the allowlist permits it. Send the "
            + "same URL with fetch to tell the two apart.",
        inconclusive: !knownImage,
      });
    });
    image.referrerPolicy = "no-referrer";
    image.src = url;
  });
}

export async function runNetworkProbe(
  url: string,
  method: NetworkProbeMethod,
): Promise<NetworkProbeResult> {
  const resolved = resolveProbeUrl(url, method);
  if (!resolved) {
    return {
      ok: false,
      status: null,
      elapsedMs: 0,
      bodyText: "",
      imageUrl: null,
      error: "Enter a URL first.",
    };
  }
  if (method === "xhr") {
    return probeWithXhr(resolved);
  }
  if (method === "img") {
    return probeWithImage(resolved, resolved === NETWORK_PRESET_BLOCKED_IMAGE);
  }
  return probeWithFetch(resolved);
}
