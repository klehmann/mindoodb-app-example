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
const currentEntryValues = computed(() => props.app.currentViewEntry?.columnValues ?? {});
const currentEntryLabel = computed(() => {
  const entry = props.app.currentViewEntry;
  if (!entry) {
    return null;
  }
  if (entry.kind === "category") {
    return entry.categoryPath[entry.categoryPath.length - 1] || "Category";
  }
  const firstColumn = props.app.visibleViewColumns[0];
  return firstColumn ? formatValue(entry.columnValues[firstColumn.name]) : entry.docId || "Document";
});

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
          <article class="metadata-card">
            <span>Categories</span>
            <strong>{{ app.viewHasCategories ? "Yes" : "No" }}</strong>
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
            <h3>Navigator rows</h3>
          </div>
          <div class="panel__actions">
            <Tag :value="`${app.viewRows.length} visible rows`" severity="secondary" rounded />
            <Tag
              v-if="app.currentViewEntry"
              :value="`Cursor: ${app.currentViewEntry.kind}`"
              severity="contrast"
              rounded
            />
          </div>
        </div>

        <Message v-if="app.viewMessage" severity="secondary" :closable="false">
          {{ app.viewMessage }}
        </Message>

        <div class="navigator-toolbar">
          <Button label="First" severity="secondary" text :disabled="app.isBusy || !app.selectedView" @click="app.gotoFirstViewEntry" />
          <Button label="Prev" severity="secondary" text :disabled="app.isBusy || !app.selectedView" @click="app.gotoPreviousViewEntry" />
          <Button label="Next" severity="secondary" text :disabled="app.isBusy || !app.selectedView" @click="app.gotoNextViewEntry" />
          <Button label="Last" severity="secondary" text :disabled="app.isBusy || !app.selectedView" @click="app.gotoLastViewEntry" />
          <Button label="Parent" severity="secondary" text :disabled="app.isBusy || !app.currentViewEntry" @click="app.gotoParentViewEntry" />
          <Button label="First child" severity="secondary" text :disabled="app.isBusy || !app.currentViewEntry" @click="app.gotoFirstChildViewEntry" />
          <Button
            v-if="app.viewHasCategories"
            label="Focus first category"
            severity="secondary"
            text
            :disabled="app.isBusy || !app.viewRows.length"
            @click="app.focusFirstVisibleViewCategory"
          />
          <Button
            v-if="app.viewHasCategories"
            label="Expand"
            severity="secondary"
            text
            :disabled="app.isBusy || !app.currentViewEntry || app.currentViewEntry.kind !== 'category' || app.currentViewEntry.expanded"
            @click="app.expandCurrentViewEntry"
          />
          <Button
            v-if="app.viewHasCategories"
            label="Collapse"
            severity="secondary"
            text
            :disabled="app.isBusy || !app.currentViewEntry || app.currentViewEntry.kind !== 'category' || !app.currentViewEntry.expanded"
            @click="app.collapseCurrentViewEntry"
          />
          <Button
            v-if="app.viewHasCategories"
            label="Expand all"
            severity="secondary"
            :disabled="!app.viewRows.length"
            @click="app.expandAllViewCategories"
          />
          <Button
            v-if="app.viewHasCategories"
            label="Collapse all"
            severity="secondary"
            :disabled="!app.viewRows.length"
            @click="app.collapseAllViewCategories"
          />
        </div>

        <article v-if="app.currentViewEntry" class="current-entry-card">
          <div class="current-entry-card__header">
            <div>
              <p class="panel__eyebrow">Current entry</p>
              <h4>{{ currentEntryLabel }}</h4>
            </div>
            <Tag :value="app.currentViewEntry.position || 'No position'" severity="secondary" rounded />
          </div>
          <div class="metadata-grid metadata-grid--entry">
            <article class="metadata-card">
              <span>Kind</span>
              <strong>{{ app.currentViewEntry.kind }}</strong>
            </article>
            <article class="metadata-card">
              <span>Level</span>
              <strong>{{ app.currentViewEntry.level }}</strong>
            </article>
            <article class="metadata-card">
              <span>Doc ID</span>
              <strong>{{ app.currentViewEntry.docId || "—" }}</strong>
            </article>
            <article class="metadata-card">
              <span>Children</span>
              <strong>{{ app.currentViewEntry.childCategoryCount + app.currentViewEntry.childDocumentCount }}</strong>
            </article>
          </div>
          <div v-if="app.visibleViewColumns.length" class="current-entry-values">
            <div
              v-for="column in app.visibleViewColumns"
              :key="`current-${column.id}`"
              class="current-entry-values__item"
            >
              <span>{{ column.title || column.name }}</span>
              <strong>{{ formatValue(currentEntryValues[column.name]) }}</strong>
            </div>
          </div>
        </article>

        <div v-if="app.visibleViewColumns.length" class="view-grid view-grid--header">
          <span v-for="column in app.visibleViewColumns" :key="column.id">{{ column.title || column.name }}</span>
        </div>

        <div v-if="app.viewRows.length" class="view-grid-stack">
          <div
            v-for="row in app.viewRows"
            :key="row.key"
            class="view-grid"
            :class="[
              row.kind === 'category' ? 'view-grid--category' : 'view-grid--document',
              app.currentViewEntry?.key === row.key ? 'view-grid--current' : '',
            ]"
            @click="app.focusViewEntry(row)"
          >
            <span v-for="column in app.visibleViewColumns" :key="`${row.key}-${column.id}`">
              <template v-if="column.id === outlineColumnId">
                <div class="outline-entry" :style="{ paddingLeft: `${row.level * 1.1}rem` }">
                  <button
                    v-if="row.kind === 'category'"
                    type="button"
                    class="category-toggle"
                    @click.stop="app.toggleCategory(row)"
                  >
                    <span class="category-toggle__sign">{{ row.expanded ? '-' : '+' }}</span>
                    <strong>{{ row.categoryPath[row.categoryPath.length - 1] || 'Category' }}</strong>
                    <small>{{ row.descendantDocumentCount }} docs</small>
                  </button>
                  <template v-else>
                    <span class="category-toggle__sign category-toggle__sign--placeholder" aria-hidden="true"></span>
                    <span>{{ formatValue(row.columnValues[column.name]) }}</span>
                  </template>
                </div>
              </template>
              <template v-else>
                {{ formatValue(row.columnValues[column.name]) }}
              </template>
            </span>
          </div>
        </div>
        <p v-if="app.viewRows.length && app.viewHasMore" class="panel__empty">
          Only the first 250 visible rows are shown in the batch preview.
        </p>
        <p v-else-if="!app.viewRows.length" class="panel__empty">
          No view rows are visible for the selected definition.
        </p>
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
.view-grid-stack,
.navigator-toolbar,
.current-entry-values {
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

.metadata-grid--entry {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.navigator-toolbar {
  grid-template-columns: repeat(auto-fit, minmax(8rem, max-content));
  align-items: center;
}

.current-entry-card {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.05);
}

.current-entry-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.current-entry-card__header h4 {
  margin: 0.25rem 0 0;
}

.current-entry-values {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.current-entry-values__item {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  border: 1px solid var(--border);
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
  cursor: pointer;
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

.view-grid--current {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent);
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

  .metadata-grid--entry {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
