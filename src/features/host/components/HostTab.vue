<script setup lang="ts">
import Button from "primevue/button";
import Tag from "primevue/tag";

import type { DemoHostSeverity } from "@/app/useHostSection";
import { t, type MessageKey } from "@/i18n";

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

const severities: Array<{ value: DemoHostSeverity; label: MessageKey }> = [
  { value: "info", label: "severityInfo" },
  { value: "warning", label: "severityWarning" },
  { value: "error", label: "severityError" },
];
</script>

<template>
  <section class="tab-section">
    <div class="summary-grid">
      <article class="glass-card summary-card">
        <span>{{ t("hostFocus") }}</span>
        <strong>{{ app.hostFocused == null ? t("unknown") : app.hostFocused ? t("yes") : t("no") }}</strong>
        <small>{{ t("hostFocusHint") }}</small>
      </article>
      <article class="glass-card summary-card">
        <span>{{ t("sdk") }}</span>
        <Tag :value="app.hostAvailable ? t('ready') : t('unavailable')" :severity="app.hostAvailable ? 'success' : 'warn'" rounded />
        <small>{{ app.hostStatus || t("hostConnectFirst") }}</small>
      </article>
    </div>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("focusEyebrow") }}</p>
          <h3>{{ t("focusHeading") }}</h3>
        </div>
      </div>
      <div class="action-row">
        <Button :label="t('checkFocus')" icon="pi pi-eye" :disabled="!app.hostAvailable" @click="app.checkHostFocus()" />
        <Button :label="t('requestFocus')" icon="pi pi-bolt" :disabled="!app.hostAvailable" @click="app.requestHostFocusNow()" />
        <Button
          :label="t('requestFocusLater')"
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
          <p class="panel__eyebrow">{{ t("noticesEyebrow") }}</p>
          <h3>{{ t("noticesHeading") }}</h3>
        </div>
      </div>
      <label class="field">
        <span>{{ t("severity") }}</span>
        <select v-model="app.hostSeverity" class="native-input" :disabled="!app.hostAvailable">
          <option v-for="severity in severities" :key="severity.value" :value="severity.value">
            {{ t(severity.label) }}
          </option>
        </select>
      </label>
      <div class="action-row">
        <Button
          :label="t('countProgress')"
          icon="pi pi-percentage"
          :disabled="!app.hostAvailable"
          @click="app.startHostProgress()"
        />
        <Button
          :label="t('notifyLater')"
          icon="pi pi-bell"
          severity="secondary"
          :disabled="!app.hostAvailable"
          @click="app.scheduleHostNotice()"
        />
        <Button :label="t('cancelTimers')" icon="pi pi-times" severity="contrast" outlined @click="app.cancelHostTimers()" />
      </div>
      <p class="panel__copy">
        {{ t("noticesCopy") }}
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
