<script setup lang="ts">
import Tag from "primevue/tag";
import type { MindooDBAppAgentTool } from "mindoodb-app-sdk";

import type { AgentUndoStep } from "@/features/agent/lib/agentUndo";

/**
 * Shows what this app offers AI agents: the tools as agents see them, whether
 * Haven lets agents call them, and the changes agents made in this session.
 */
const props = defineProps<{
  app: {
    agentTools: MindooDBAppAgentTool[];
    exposedToolNames: string[];
    agentToolsEnabled: boolean;
    agentToolsStatus: string;
    agentSteps: AgentUndoStep[];
  };
}>();

/** Haven prefixes the names (`agentToolPrefix` in haven-app.json): `undo` becomes `example_undo`. */
function exposedName(name: string) {
  return props.app.exposedToolNames.find((exposed) => exposed.endsWith(`_${name}`)) ?? name;
}

function firstSentence(text: string) {
  return text.split(/(?<=\.)\s/)[0];
}
</script>

<template>
  <section class="tab-section">
    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Agent tools (WebMCP)</p>
          <h3>Operations this app offers AI agents through Haven</h3>
        </div>
        <Tag
          :value="app.agentToolsEnabled ? 'Agents can call them' : 'Not offered to agents'"
          :severity="app.agentToolsEnabled ? 'success' : 'warn'"
          rounded
        />
      </div>
      <p class="panel__copy">{{ app.agentToolsStatus }}</p>
      <ul class="tool-list">
        <li v-for="tool in app.agentTools" :key="tool.name">
          <code>{{ exposedName(tool.name) }}</code>
          <span>{{ firstSentence(tool.description) }}</span>
        </li>
      </ul>
      <p class="panel__copy">
        Code: <code>src/features/agent/lib/exampleAgentTools.ts</code> (the tools),
        <code>src/app/useAgentSection.ts</code> (registration and context) and the <code>agent</code> block in
        <code>public/haven-app.json</code>.
      </p>
    </section>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Agent changes</p>
          <h3>Every agent write is one undo step</h3>
        </div>
      </div>
      <p v-if="!app.agentSteps.length" class="panel__copy">No agent changes in this session yet.</p>
      <ul v-else class="tool-list">
        <li v-for="step in [...app.agentSteps].reverse()" :key="step.id">
          <code>{{ step.id }}</code>
          <span>{{ step.label }} · {{ new Date(step.at).toLocaleTimeString() }}</span>
          <Tag v-if="step.undone" value="undone" severity="secondary" rounded />
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.tab-section,
.panel {
  display: grid;
  gap: 1rem;
}

.panel__header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.panel__eyebrow,
.panel__copy,
.panel h3 {
  margin: 0;
}

.panel__eyebrow {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tool-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tool-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
}

.tool-list span {
  color: var(--muted);
}
</style>
