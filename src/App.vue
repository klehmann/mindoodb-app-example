<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import Tag from "primevue/tag";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";
import DatabasesTab from "@/features/databases/components/DatabasesTab.vue";
import EventsTab from "@/features/events/components/EventsTab.vue";
import ViewsTab from "@/features/views/components/ViewsTab.vue";

const app = reactive(useMindooDBDemoApp());
const activeTab = ref<"databases" | "views" | "events">("databases");

const tabOptions = [
  { id: "databases", label: "Databases" },
  { id: "views", label: "Views" },
  { id: "events", label: "Events" },
] as const;

const viewportLabel = computed(() =>
  app.hostViewport ? `${Math.round(app.hostViewport.width)} x ${Math.round(app.hostViewport.height)}` : "pending",
);

onMounted(() => {
  void app.connect();
});
</script>

<template>
  <main class="page-shell">
    <section class="hero glass-card">
      <div class="hero__copy">
        <p class="hero__eyebrow">MindooDB sample app</p>
        <h1>Haven demo app</h1>
        <p class="hero__summary">
          Explore generic document CRUD, mapped views, and host events through the MindooDB App SDK.
          This demo mirrors the Mindoo theme used by the time-record sample while keeping the code feature-based and SDK-focused.
        </p>
      </div>

      <div class="hero__meta">
        <Tag :value="`${app.hostTheme.preset} preset`" severity="warn" rounded />
        <Tag :value="`${app.hostTheme.mode} mode`" severity="contrast" rounded />
        <Tag :value="`${viewportLabel} viewport`" severity="secondary" rounded />
        <Tag v-if="app.launchContext" :value="`${app.launchContext.databases.length} mapped databases`" severity="help" rounded />
        <Tag v-if="app.launchContext" :value="`${app.launchContext.views.length} mapped views`" severity="info" rounded />
      </div>

      <div class="hero__actions">
        <Button label="Reconnect" icon="pi pi-refresh" :disabled="app.loading" @click="app.connect" />
        <span v-if="app.busyAction" class="hero__busy">
          <ProgressSpinner style="width: 1rem; height: 1rem" stroke-width="8" />
          {{ app.busyAction }}
        </span>
      </div>
    </section>

    <Message v-if="app.error" severity="warn" :closable="false">
      {{ app.error }}
    </Message>
    <Message v-else-if="app.successMessage" severity="success" :closable="false">
      {{ app.successMessage }}
    </Message>

    <section class="tab-shell glass-card">
      <nav class="tab-nav" aria-label="App tabs">
        <button
          v-for="tab in tabOptions"
          :key="tab.id"
          class="tab-nav__button"
          :class="{ 'tab-nav__button--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <DatabasesTab v-if="activeTab === 'databases'" :app="app" />
      <ViewsTab v-else-if="activeTab === 'views'" :app="app" />
      <EventsTab v-else :app="app" />
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  display: grid;
  gap: 1rem;
  max-width: 1480px;
  margin: 0 auto;
  padding: 1.25rem;
}

.glass-card {
  padding: 1.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
  backdrop-filter: var(--surface-blur);
}

.hero,
.hero__actions,
.hero__meta,
.tab-shell {
  display: grid;
  gap: 1rem;
}

.hero__eyebrow,
.hero__summary {
  margin: 0;
}

.hero__eyebrow {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hero h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(2rem, 4vw, 3rem);
}

.hero__summary {
  max-width: 70ch;
  line-height: 1.6;
}

.hero__meta {
  grid-template-columns: repeat(auto-fit, minmax(10rem, max-content));
  align-items: center;
}

.hero__actions {
  grid-template-columns: max-content 1fr;
  align-items: center;
}

.hero__busy {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--muted);
}

.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.tab-nav__button {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.75rem 1rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.tab-nav__button--active {
  background: rgba(212, 160, 23, 0.18);
  border-color: var(--border-strong);
}

:deep(.native-input) {
  width: 100%;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.85rem;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
}

:deep(.field) {
  display: grid;
  gap: 0.35rem;
}

@media (max-width: 720px) {
  .page-shell {
    padding: 0.85rem;
  }

  .hero__actions {
    grid-template-columns: 1fr;
  }
}
</style>
