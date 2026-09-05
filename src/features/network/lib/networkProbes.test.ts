import { describe, expect, it } from "vitest";

import {
  NETWORK_PRESET_BLOCKED,
  NETWORK_PRESET_BLOCKED_IMAGE,
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
});
