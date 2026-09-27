<script setup lang="ts">
import Button from "primevue/button";
import Tag from "primevue/tag";

import type { DemoHostSeverity } from "@/app/useHostSection";

defineProps<{
  app: {
    hostFocused: boolean | null;
    hostAvailable: boolean;
    hostStatus: string;
    hostSeverity: DemoHostSeverity;
    checkHostFocus: () => Promise<void>;
    requestHostFocusNow: () => Promise<void>;
    requestHostFocusLater: () => void;
    startHostProgress: () => void;
    scheduleHostNotice: () => void;
    cancelHostTimers: () => void;
  };
}>();

const severities: DemoHostSeverity[] = ["info", "warning", "error"];
</script>

<template>
  <section class="tab-section">
    <div class="summary-grid">
      <article class="glass-card summary-card">
        <span>Host focus</span>
        <strong>{{ app.hostFocused == null ? "Unknown" : app.hostFocused ? "Yes" : "No" }}</strong>
        <small>Focused tile on the active page, or this launch on its runner page</small>
      </article>
      <article class="glass-card summary-card">
        <span>SDK</span>
        <Tag :value="app.hostAvailable ? 'Ready' : 'Unavailable'" :severity="app.hostAvailable ? 'success' : 'warn'" rounded />
        <small>{{ app.hostStatus }}</small>
      </article>
    </div>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Focus</p>
          <h3>See whether this launch is the one on screen</h3>
        </div>
      </div>
      <div class="action-row">
        <Button label="Check focus" icon="pi pi-eye" :disabled="!app.hostAvailable" @click="app.checkHostFocus()" />
        <Button label="Request focus" icon="pi pi-bolt" :disabled="!app.hostAvailable" @click="app.requestHostFocusNow()" />
        <Button
          label="Request focus in 4 seconds"
          icon="pi pi-clock"
          severity="secondary"
          :disabled="!app.hostAvailable"
          @click="app.requestHostFocusLater()"
        />
      </div>
    </section>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Notices</p>
          <h3>Update one notice, or send one you can click later</h3>
        </div>
      </div>
      <label class="field">
        <span>Severity</span>
        <select v-model="app.hostSeverity" class="native-input" :disabled="!app.hostAvailable">
          <option v-for="severity in severities" :key="severity" :value="severity">{{ severity }}</option>
        </select>
      </label>
      <div class="action-row">
        <Button
          label="Count 0% to 100%"
          icon="pi pi-percentage"
          :disabled="!app.hostAvailable"
          @click="app.startHostProgress()"
        />
        <Button
          label="Notify in 4 seconds"
          icon="pi pi-bell"
          severity="secondary"
          :disabled="!app.hostAvailable"
          @click="app.scheduleHostNotice()"
        />
        <Button label="Cancel timers" icon="pi pi-times" severity="contrast" outlined @click="app.cancelHostTimers()" />
      </div>
      <p class="panel__copy">
        The count reuses one notice id, so Haven updates that row every 10%. The delayed notice stays until you dismiss it or click it. Clicking it should bring this app back.
      </p>
    </section>
  </section>
</template>

<style scoped>
.tab-section,
.summary-grid,
.panel,
.summary-card,
.action-row {
  display: grid;
  gap: 1rem;
}

.summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-card {
  align-content: start;
}

.summary-card :deep(.p-tag) {
  justify-self: start;
}

.panel__header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.panel__eyebrow,
.panel__copy,
.summary-card span,
.summary-card small {
  margin: 0;
}

.summary-card span {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.field {
  display: grid;
  gap: 0.35rem;
  max-width: 16rem;
}

.panel__eyebrow {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel__copy {
  color: var(--muted);
  line-height: 1.5;
}

.action-row {
  grid-template-columns: repeat(auto-fit, minmax(14rem, max-content));
}

@media (max-width: 720px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
