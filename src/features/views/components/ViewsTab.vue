<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";

const props = defineProps<{
  app: any;
}>();

const outlineColumnId = computed(() =>
  props.app.visibleViewColumns.find((column: { role: string }) => column.role === "category")?.id
  ?? props.app.visibleViewColumns[0]?.id
  ?? null,
);

function handleViewChange(event: Event) {
  const viewId = (event.target as HTMLSelectElement).value;
  props.app.setSelectedView(viewId || null);
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value == null || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
</script>

<template>
  <section class="tab-section">
    <div class="section-toolbar">
      <label class="field">
        <span class="field__label">Selected view</span>
        <select class="native-input" :value="app.selectedViewId ?? ''" @change="handleViewChange">
          <option disabled value="">Select view</option>
          <option v-for="view in app.availableViews" :key="view.id" :value="view.id">
            {{ view.id }}
          </option>
        </select>
      </label>

      <div class="panel__actions">
        <Button label="Refresh" severity="secondary" text :disabled="app.isBusy" @click="app.loadSelectedView" />
        <Button label="Expand all" severity="secondary" :disabled="!app.viewRows.length" @click="app.expandAllViewCategories" />
        <Button label="Collapse all" severity="secondary" :disabled="!app.viewRows.length" @click="app.collapseAllViewCategories" />
      </div>
    </div>

    <div v-if="!app.availableViews.length" class="glass-card empty-state">
      No Haven view mappings were provided for this app launch.
    </div>

    <div v-else-if="!app.selectedView" class="glass-card empty-state">
      Select one of the available Haven-managed views to inspect its columns and result rows.
    </div>

    <div v-else class="view-layout">
      <section class="glass-card panel">
        <div class="panel__header">
          <div>
            <p class="panel__eyebrow">Definition</p>
            <h3>{{ app.selectedView.id }}</h3>
          </div>
        </div>

        <p v-if="app.selectedView.description" class="definition-copy">{{ app.selectedView.description }}</p>

        <div class="metadata-grid">
          <article class="metadata-card">
            <span>Columns</span>
            <strong>{{ app.visibleViewColumns.length }}</strong>
          </article>
          <article class="metadata-card">
            <span>Sources</span>
            <strong>{{ app.selectedView.sources.length }}</strong>
          </article>
        </div>

        <div class="source-list">
          <article v-for="source in app.selectedView.sources" :key="`${source.origin}-${source.databaseId}`" class="source-item">
            <strong>{{ source.title }}</strong>
            <span>{{ source.tenantId }}/{{ source.databaseName }}</span>
            <span>{{ source.targetMode }}</span>
          </article>
        </div>
      </section>

      <section class="glass-card panel panel--result">
        <div class="panel__header">
          <div>
            <p class="panel__eyebrow">Results</p>
            <h3>Categorized rows</h3>
          </div>
          <Tag :value="`${app.viewRows.length} visible rows`" severity="secondary" rounded />
        </div>

        <Message v-if="app.viewMessage" severity="secondary" :closable="false">
          {{ app.viewMessage }}
        </Message>

        <div v-if="app.visibleViewColumns.length" class="view-grid view-grid--header">
          <span v-for="column in app.visibleViewColumns" :key="column.id">{{ column.title || column.name }}</span>
        </div>

        <div v-if="app.viewRows.length" class="view-grid-stack">
          <div
            v-for="row in app.viewRows"
            :key="row.key"
            class="view-grid"
            :class="row.type === 'category' ? 'view-grid--category' : 'view-grid--document'"
          >
            <span v-for="column in app.visibleViewColumns" :key="`${row.key}-${column.id}`">
              <template v-if="column.id === outlineColumnId">
                <div class="outline-entry" :style="{ paddingLeft: `${row.level * 1.1}rem` }">
                  <button
                    v-if="row.type === 'category'"
                    type="button"
                    class="category-toggle"
                    @click="app.toggleCategory(row)"
                  >
                    <span class="category-toggle__sign">{{ row.expanded ? '-' : '+' }}</span>
                    <strong>{{ row.categoryPath[row.categoryPath.length - 1] || 'Category' }}</strong>
                    <small>{{ row.descendantDocumentCount }} docs</small>
                  </button>
                  <template v-else>
                    <span class="category-toggle__sign category-toggle__sign--placeholder" aria-hidden="true"></span>
                    <span>{{ formatValue(row.values[column.name]) }}</span>
                  </template>
                </div>
              </template>
              <template v-else>
                {{ formatValue(row.values[column.name]) }}
              </template>
            </span>
          </div>
        </div>
        <p v-else class="panel__empty">No view rows are visible for the selected definition.</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tab-section,
.view-layout,
.panel,
.metadata-grid,
.source-list,
.view-grid-stack {
  display: grid;
  gap: 1rem;
}

.section-toolbar,
.panel__header,
.panel__actions,
.source-item {
  display: flex;
  gap: 0.75rem;
}

.section-toolbar,
.panel__header,
.source-item {
  align-items: center;
  justify-content: space-between;
}

.view-layout {
  grid-template-columns: minmax(20rem, 24rem) minmax(0, 1fr);
}

.definition-copy,
.panel__eyebrow,
.panel__empty {
  margin: 0;
}

.panel__eyebrow,
.field__label {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.metadata-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metadata-card,
.source-item {
  padding: 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
}

.metadata-card {
  display: grid;
  gap: 0.25rem;
}

.panel--result {
  overflow: auto;
}

.view-grid {
  display: grid;
  grid-template-columns: minmax(12rem, 1.2fr) repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  align-items: center;
}

.view-grid--header {
  background: transparent;
  border-style: dashed;
  color: var(--muted);
  font-size: 0.9rem;
}

.view-grid--category {
  background: rgba(255, 255, 255, 0.06);
}

.category-toggle {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
}

.outline-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.category-toggle__sign {
  display: inline-flex;
  width: 0.75rem;
  justify-content: center;
  flex: 0 0 0.75rem;
}

.category-toggle__sign--placeholder {
  visibility: hidden;
}

.empty-state {
  padding: 1.4rem;
  color: var(--muted);
}

@media (max-width: 980px) {
  .view-layout {
    grid-template-columns: 1fr;
  }
}
</style>
