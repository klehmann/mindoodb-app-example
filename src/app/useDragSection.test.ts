import { describe, expect, it } from "vitest";

import { createDemoDragSources, offersForSource } from "@/app/useDragSection";

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
});
