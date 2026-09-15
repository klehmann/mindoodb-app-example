import { describe, expect, it } from "vitest";

import { createDemoDragSources, hitDemoDropZone, offersForSource } from "@/app/useDragSection";

describe("useDragSection helpers", () => {
  it("builds copy offers from the enabled types only", () => {
    const [plain, markdown] = createDemoDragSources();
    expect(offersForSource(plain!)).toEqual([
      { type: "text/plain", data: "Notes from the example app" },
    ]);
    markdown!.enabledTypes = ["text/markdown"];
    expect(offersForSource(markdown!)).toEqual([
      {
        type: "text/markdown",
        data: "## Meeting notes\n\n- **Agenda**\n- Follow-ups for the next chicklet",
      },
    ]);
  });

  it("hits a drop zone by bounding box when elementFromPoint misses", () => {
    const zone = document.createElement("section");
    zone.setAttribute("data-drop-zone", "");
    Object.defineProperty(zone, "getBoundingClientRect", {
      value: () => ({
        left: 10,
        top: 20,
        right: 110,
        bottom: 80,
        width: 100,
        height: 60,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }),
    });
    document.body.appendChild(zone);
    expect(hitDemoDropZone(40, 40)).toBe(true);
    expect(hitDemoDropZone(0, 0)).toBe(false);
    zone.remove();
  });
});
