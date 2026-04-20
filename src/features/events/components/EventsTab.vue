<script setup lang="ts">
import Tag from "primevue/tag";

defineProps<{
  app: any;
}>();

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}
</script>

<template>
  <section class="tab-section">
    <div class="summary-grid">
      <article class="glass-card summary-card">
        <span>Theme mode</span>
        <strong>{{ app.hostTheme.mode }}</strong>
        <Tag :value="app.hostTheme.preset" severity="secondary" rounded />
      </article>
      <article class="glass-card summary-card">
        <span>Viewport</span>
        <strong>{{ app.hostViewport ? `${Math.round(app.hostViewport.width)} x ${Math.round(app.hostViewport.height)}` : "pending" }}</strong>
        <small>Reported by the Haven host</small>
      </article>
      <article class="glass-card summary-card">
        <span>UI preferences</span>
        <strong>{{ app.hostUiPreferences.iosMultitaskingOptimized ? "Shift nav right" : "Default mobile nav" }}</strong>
        <small>Host-controlled app shell behavior</small>
      </article>
      <article class="glass-card summary-card">
        <span>Event count</span>
        <strong>{{ app.eventLog.length }}</strong>
        <small>Initial snapshots plus live updates</small>
      </article>
    </div>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Incoming events</p>
          <h3>Theme, resize, and UI preference activity</h3>
        </div>
      </div>

      <div v-if="app.eventLog.length" class="event-list">
        <article v-for="entry in app.eventLog" :key="entry.id" class="event-item">
          <div class="event-item__meta">
            <Tag :value="entry.kind" severity="contrast" rounded />
            <span>{{ formatTimestamp(entry.createdAt) }}</span>
          </div>
          <strong>{{ entry.label }}</strong>
          <pre>{{ entry.payload }}</pre>
        </article>
      </div>
      <p v-else class="panel__empty">Connect to Haven to start receiving host events.</p>
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
