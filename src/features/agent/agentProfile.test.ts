/**
 * The `agent` block of public/haven-app.json and public/agent/agent.en.md tell
 * agents what the app's tools do before the app runs (`haven_apps_describe`).
 * This test keeps them in step with the tools: every capability names
 * registered tools, every tool belongs to a capability, and neither the guide
 * nor any tool description names a tool that does not exist.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkAgentManifest } from "mindoodb-app-sdk/testing";
import { describe, expect, it } from "vitest";

import { createExampleAgentTools, type ExampleAgentDeps } from "@/features/agent/lib/exampleAgentTools";

// jsdom gives import.meta.url an http URL; vitest runs from the project root.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the example app's agent profile", () => {
  it("matches the registered tools and the agent guide", () => {
    const definition = JSON.parse(read("public/haven-app.json"));
    // Only the declarations are read; no tool runs.
    const tools = createExampleAgentTools({} as ExampleAgentDeps);

    const result = checkAgentManifest({
      definition,
      tools,
      guideTexts: {
        "agent.en.md": read(`public/${definition.agent.guide.en}`),
        ...Object.fromEntries(tools.map((tool) => [`${tool.name} description`, tool.description])),
      },
    });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it("keeps the guide within what Haven loads", () => {
    expect(new TextEncoder().encode(read("public/agent/agent.en.md")).length).toBeLessThanOrEqual(8 * 1024);
  });
});
