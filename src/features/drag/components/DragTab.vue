<script setup lang="ts">
import { nextTick, onMounted, watch } from "vue";
import Tag from "primevue/tag";

const cardRefs = new Map<string, HTMLElement>();

const props = defineProps<{
  app: {
    sources: Array<{
      id: string;
      title: string;
      offers: Record<string, string>;
      enabledTypes: string[];
    }>;
    lastDrop: Record<string, string> | null;
    hoverActive: boolean;
    dragReady: boolean;
    bindSourceCard: (element: HTMLElement | null, sourceId: string) => void;
    toggleType: (sourceId: string, type: string, enabled: boolean) => void;
  };
}>();

function setCardRef(sourceId: string, element: Element | null) {
  if (element instanceof HTMLElement) {
    cardRefs.set(sourceId, element);
  } else {
    cardRefs.delete(sourceId);
  }
}

function bindCards() {
  for (const [sourceId, element] of cardRefs) {
    props.app.bindSourceCard(element, sourceId);
  }
}

onMounted(() => {
  void nextTick(() => bindCards());
});

watch(
  () => [props.app.dragReady, props.app.sources.map((source) => source.id).join(",")],
  () => {
    void nextTick(() => bindCards());
  },
);
</script>

<template>
  <section class="tab-section">
    <div class="summary-grid">
      <article class="glass-card summary-card">
        <span>Gesture</span>
        <strong>Copy only</strong>
        <small>Mouse moves 8px; touch uses a long-press</small>
      </article>
      <article class="glass-card summary-card">
        <span>Last drop</span>
        <strong>{{ app.lastDrop ? `${Object.keys(app.lastDrop).length} types` : "None yet" }}</strong>
        <small>Source cards never change</small>
      </article>
    </div>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Sources</p>
          <h3>Drag a card into another example-app chicklet</h3>
        </div>
      </div>
      <div class="source-grid">
        <article
          v-for="source in app.sources"
          :key="source.id"
          :ref="(element) => setCardRef(source.id, element as Element | null)"
          class="source-card"
        >
          <div class="source-card__title">
            <strong>{{ source.title }}</strong>
            <Tag value="Drag" severity="secondary" rounded />
          </div>
          <label
            v-for="type in Object.keys(source.offers)"
            :key="type"
            class="source-card__type"
            @pointerdown.stop
          >
            <input
              type="checkbox"
              :checked="source.enabledTypes.includes(type)"
              @change="app.toggleType(source.id, type, ($event.target as HTMLInputElement).checked)"
            >
            <span>{{ type }}</span>
          </label>
          <pre>{{ source.offers[source.enabledTypes[0] ?? Object.keys(source.offers)[0]!] }}</pre>
        </article>
      </div>
    </section>

    <section
      class="glass-card panel drop-zone"
      data-drop-zone
      :class="{ 'drop-zone--active': app.hoverActive }"
    >
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Drop zone</p>
          <h3>Received copy payloads</h3>
        </div>
      </div>
      <p v-if="!app.lastDrop" class="panel__empty">
        Drop here from another visible example-app chicklet. Every accepted type is shown.
      </p>
      <div v-else class="drop-list">
        <article v-for="type in Object.keys(app.lastDrop)" :key="type" class="drop-item">
          <Tag :value="type" severity="contrast" rounded />
          <pre>{{ app.lastDrop[type] }}</pre>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.tab-section,
.summary-grid,
.panel,
.source-grid,
.drop-list,
.summary-card {
  display: grid;
  gap: 1rem;
}

.summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.source-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.source-card,
.drop-item {
  display: grid;
  gap: 0.6rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  touch-action: none;
  user-select: none;
}

.source-card__title,
.source-card__type {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.drop-zone {
  min-height: 12rem;
}

.drop-zone--active {
  outline: 2px solid var(--p-primary-color, #6ea8fe);
}

.panel__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
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

pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
  font-size: 0.82rem;
}

@media (max-width: 820px) {
  .summary-grid,
  .source-grid {
    grid-template-columns: 1fr;
  }
}
</style>
