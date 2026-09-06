import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  NETWORK_PRESET_ALLOWED,
  NETWORK_PRESET_BLOCKED,
  NETWORK_PRESET_BLOCKED_IMAGE,
  probeWithImage,
  resolveProbeUrl,
} from "@/features/network/lib/networkProbes";

describe("network probes", () => {
  it("keeps a typed URL unchanged for fetch and XHR", () => {
    expect(resolveProbeUrl("https://example.test/api", "fetch")).toBe("https://example.test/api");
    expect(resolveProbeUrl("https://example.test/api", "xhr")).toBe("https://example.test/api");
  });

  it("switches the httpbin preset to the PNG URL for the image probe", () => {
    expect(resolveProbeUrl(NETWORK_PRESET_BLOCKED, "img")).toBe(NETWORK_PRESET_BLOCKED_IMAGE);
    expect(resolveProbeUrl(NETWORK_PRESET_BLOCKED, "fetch")).toBe(NETWORK_PRESET_BLOCKED);
  });

  it("leaves the allowed preset alone, which an image probe cannot render", () => {
    // Open-Meteo answers JSON and there is no image on an allowlisted host, so
    // `img` + this preset always fails. The next test pins that the probe
    // reports that honestly instead of calling it a block.
    expect(resolveProbeUrl(NETWORK_PRESET_ALLOWED, "img")).toBe(NETWORK_PRESET_ALLOWED);
  });

  it("calls an image failure inconclusive unless the URL is known to be an image", async () => {
    // jsdom never fetches an <img>, so neither `load` nor `error` would ever
    // fire and the probe's promise would hang. Stand in an element that fails
    // as soon as `src` is assigned.
    class FailingImage {
      private handlers: Record<string, Array<() => void>> = {};
      referrerPolicy = "";
      addEventListener(type: string, handler: () => void) {
        (this.handlers[type] ??= []).push(handler);
      }
      set src(_url: string) {
        queueMicrotask(() => this.handlers.error?.forEach((handler) => handler()));
      }
    }
    vi.stubGlobal("Image", FailingImage);
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    const failing = await probeWithImage("https://example.test/data.json");
    expect(failing.ok).toBe(false);
    expect(failing.inconclusive).toBe(true);
    expect(failing.error).toContain("not known to serve an image");

    const known = await probeWithImage(NETWORK_PRESET_BLOCKED_IMAGE, true);
    expect(known.ok).toBe(false);
    expect(known.inconclusive).toBe(false);
    expect(known.error).toBe("Image failed to load");
  });
});
