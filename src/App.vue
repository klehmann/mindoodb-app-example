<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import Tag from "primevue/tag";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";
import DatabasesTab from "@/features/databases/components/DatabasesTab.vue";
import EventsTab from "@/features/events/components/EventsTab.vue";
import IsolationTab from "@/features/isolation/components/IsolationTab.vue";
import NetworkTab from "@/features/network/components/NetworkTab.vue";
import DragTab from "@/features/drag/components/DragTab.vue";
import EmbedsTab from "@/features/embeds/components/EmbedsTab.vue";
import HostTab from "@/features/host/components/HostTab.vue";
import ViewsTab from "@/features/views/components/ViewsTab.vue";
import AgentTab from "@/features/agent/components/AgentTab.vue";
import { t, tn, type MessageKey } from "@/i18n";

const app = reactive(useMindooDBDemoApp());
const activeTab = ref<"databases" | "views" | "events" | "drag" | "embeds" | "network" | "isolation" | "host" | "agent">("databases");

// Labels are i18n keys, translated in the template so they follow a language change.
const tabOptions = [
  { id: "databases", label: "tabDatabases" },
  { id: "views", label: "tabViews" },
  { id: "events", label: "tabEvents" },
  { id: "drag", label: "tabDrag" },
  { id: "embeds", label: "tabEmbeds" },
  { id: "network", label: "tabNetwork" },
  { id: "isolation", label: "tabIsolation" },
  { id: "host", label: "tabHost" },
  { id: "agent", label: "tabAgent" },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;

const viewportLabel = computed(() =>
  app.hostViewport ? `${Math.round(app.hostViewport.width)} x ${Math.round(app.hostViewport.height)}` : t("pending"),
);

onMounted(() => {
  void app.connect();
});
</script>

<template>
  <main class="page-shell">
    <section class="hero glass-card">
      <div class="hero__copy">
        <p class="hero__eyebrow">{{ t("appEyebrow") }}</p>
        <h1>{{ t("appTitle") }}</h1>
        <p class="hero__summary">{{ t("appSummary") }}</p>
      </div>

      <div class="hero__meta">
        <Tag :value="t('heroPreset', { preset: app.hostTheme.preset })" severity="warn" rounded />
        <Tag
          :value="t('heroMode', { mode: t(app.hostTheme.mode === 'light' ? 'modeLight' : 'modeDark') })"
          severity="contrast"
          rounded
        />
        <Tag :value="t('heroViewport', { size: viewportLabel })" severity="secondary" rounded />
        <Tag v-if="app.launchContext" :value="tn('heroDatabases', app.launchContext.databases.length)" severity="help" rounded />
        <Tag v-if="app.launchContext" :value="tn('heroViews', app.launchContext.views.length)" severity="info" rounded />
        <Tag v-if="app.isTimeTravelActive" :value="t('heroTimeTravel', { date: app.timeTravelDateLabel })" severity="warn" rounded />
      </div>

      <div class="hero__actions">
        <Button :label="t('reconnect')" icon="pi pi-refresh" :disabled="app.loading" @click="app.connect" />
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
    <Message v-if="app.isTimeTravelActive" severity="info" :closable="false">
      {{ t("timeTravelActive", { date: app.timeTravelDateLabel }) }}
    </Message>

    <section class="tab-shell glass-card">
      <nav class="tab-nav" :aria-label="t('tabsLabel')">
        <button
          v-for="tab in tabOptions"
          :key="tab.id"
          class="tab-nav__button"
          :class="{ 'tab-nav__button--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ t(tab.label) }}
        </button>
      </nav>

      <DatabasesTab v-if="activeTab === 'databases'" :app="app" />
      <ViewsTab v-else-if="activeTab === 'views'" :app="app" />
      <EventsTab v-else-if="activeTab === 'events'" :app="app" />
      <DragTab v-else-if="activeTab === 'drag'" :app="app" />
      <NetworkTab v-else-if="activeTab === 'network'" />
      <IsolationTab v-else-if="activeTab === 'isolation'" />
      <AgentTab v-else-if="activeTab === 'agent'" :app="app" />
      <HostTab v-else-if="activeTab === 'host'" :app="app" />
      <!-- Kept mounted: an open editor lives in an element of this tab and would close with it. -->
      <EmbedsTab v-show="activeTab === 'embeds'" :app="app" :active="activeTab === 'embeds'" />
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
