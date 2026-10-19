<script setup lang="ts">
import Tag from "primevue/tag";

import { formatDateTime, t } from "@/i18n";

defineProps<{
  app: any;
}>();

</script>

<template>
  <section class="tab-section">
    <div class="summary-grid">
      <article class="glass-card summary-card">
        <span>{{ t("themeMode") }}</span>
        <strong>{{ app.hostTheme.mode === "light" ? t("modeLight") : t("modeDark") }}</strong>
        <Tag :value="app.hostTheme.preset" severity="secondary" rounded />
      </article>
      <article class="glass-card summary-card">
        <span>{{ t("viewport") }}</span>
        <strong>{{ app.hostViewport ? `${Math.round(app.hostViewport.width)} x ${Math.round(app.hostViewport.height)}` : t("pending") }}</strong>
        <small>{{ t("reportedByHost") }}</small>
      </article>
      <article class="glass-card summary-card">
        <span>{{ t("uiPreferences") }}</span>
        <strong>{{ app.hostUiPreferences.iosMultitaskingOptimized ? t("shiftNavRight") : t("defaultMobileNav") }}</strong>
        <small>{{ t("hostControlledShell") }}</small>
      </article>
      <article class="glass-card summary-card">
        <span>{{ t("eventCount") }}</span>
        <strong>{{ app.eventLog.length }}</strong>
        <small>{{ t("eventCountHint") }}</small>
      </article>
    </div>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("incomingEvents") }}</p>
          <h3>{{ t("eventsHeading") }}</h3>
        </div>
      </div>

      <div v-if="app.eventLog.length" class="event-list">
        <article v-for="entry in app.eventLog" :key="entry.id" class="event-item">
          <div class="event-item__meta">
            <Tag :value="entry.kind" severity="contrast" rounded />
            <span>{{ formatDateTime(entry.createdAt) }}</span>
          </div>
          <strong>{{ entry.label }}</strong>
          <pre>{{ entry.payload }}</pre>
        </article>
      </div>
      <p v-else class="panel__empty">{{ t("eventsEmpty") }}</p>
    </section>
  </section>
</template>

<style scoped>
.tab-section,
.summary-grid,
.panel,
.event-list,
.summary-card {
  display: grid;
  gap: 1rem;
}

.summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-card {
  align-content: start;
}

.panel__header,
.event-item__meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.panel__eyebrow,
.panel__empty,
.summary-card span,
.summary-card small,
pre {
  margin: 0;
}

.panel__eyebrow,
.summary-card span {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.event-item {
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
  font-size: 0.82rem;
}

@media (max-width: 820px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
