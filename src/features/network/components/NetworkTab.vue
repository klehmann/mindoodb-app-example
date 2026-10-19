<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";

import { segments, t } from "@/i18n";

import {
  NETWORK_PRESET_ALLOWED,
  NETWORK_PRESET_BLOCKED,
  type NetworkProbeMethod,
  type NetworkProbeResult,
  runNetworkProbe,
} from "@/features/network/lib/networkProbes";

const url = ref(NETWORK_PRESET_ALLOWED);
const method = ref<NetworkProbeMethod>("fetch");
const busy = ref(false);
const result = ref<NetworkProbeResult | null>(null);
const resultPanel = ref<HTMLElement | null>(null);

/**
 * Three outcomes, not two. A failed `img` probe on a URL that may not be an
 * image cannot attribute the failure to the allowlist, so it must not be
 * labelled `blocked` — see `NetworkProbeResult.inconclusive`.
 */
const verdict = computed(() => {
  if (!result.value) return null;
  if (result.value.ok) return { label: t("verdictOk"), severity: "success", heading: t("requestCompleted") };
  if (result.value.inconclusive) {
    return { label: t("verdictUnclear"), severity: "info", heading: t("resultInconclusive") };
  }
  return { label: t("verdictBlocked"), severity: "warn", heading: t("requestFailed") };
});

const methodOptions: Array<{ id: NetworkProbeMethod; label: string }> = [
  { id: "fetch", label: "fetch" },
  { id: "xhr", label: "XMLHttpRequest" },
  { id: "img", label: "img" },
];

function applyPreset(nextUrl: string) {
  url.value = nextUrl;
}

async function runProbe() {
  busy.value = true;
  result.value = null;
  try {
    result.value = await runNetworkProbe(url.value, method.value);
  } finally {
    busy.value = false;
  }
  await revealResult();
}

/**
 * Bring the result panel into view. It sits below the fold on most window
 * sizes, so without this a blocked request looks like nothing happened at all.
 *
 * The panel is `v-if`'d on the result, so it does not exist until Vue has
 * flushed — hence `nextTick` before reaching for the ref.
 *
 * Scrolling stops at this document. The app is framed cross-origin from Haven,
 * so the browser will not let `scrollIntoView` walk into the host page.
 */
async function revealResult() {
  await nextTick();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  resultPanel.value?.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "nearest",
  });
}
</script>

<template>
  <section class="tab-section">
    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("networkEyebrow") }}</p>
          <h3>{{ t("networkHeading") }}</h3>
        </div>
      </div>
      <p class="panel__copy">
        <template v-for="(part, index) in segments('networkCopy', { header: 'Access-Control-Allow-Origin: *' })" :key="index">
          <code v-if="part.param">{{ part.text }}</code>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>

      <div class="preset-row">
        <Button
          :label="t('presetAllowed')"
          severity="secondary"
          size="small"
          @click="applyPreset(NETWORK_PRESET_ALLOWED)"
        />
        <Button
          :label="t('presetBlocked')"
          severity="secondary"
          size="small"
          @click="applyPreset(NETWORK_PRESET_BLOCKED)"
        />
      </div>

      <label class="field">
        <span>{{ t("url") }}</span>
        <input v-model="url" class="native-input" type="url" spellcheck="false" />
      </label>

      <div class="method-row">
        <span>{{ t("method") }}</span>
        <div class="method-row__buttons">
          <button
            v-for="option in methodOptions"
            :key="option.id"
            type="button"
            class="method-chip"
            :class="{ 'method-chip--active': method === option.id }"
            @click="method = option.id"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <Button :label="t('sendRequest')" icon="pi pi-send" :loading="busy" :disabled="busy" @click="runProbe" />
    </section>

    <section v-if="result" ref="resultPanel" class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("resultEyebrow") }}</p>
          <h3>{{ verdict?.heading }}</h3>
        </div>
        <Tag :value="verdict?.label" :severity="verdict?.severity" rounded />
      </div>
      <dl class="result-meta">
        <div>
          <dt>{{ t("status") }}</dt>
          <dd>{{ result.status ?? "—" }}</dd>
        </div>
        <div>
          <dt>{{ t("time") }}</dt>
          <dd>{{ result.elapsedMs }} ms</dd>
        </div>
      </dl>
      <p v-if="result.error" class="result-error">{{ result.error }}</p>
      <img v-if="result.imageUrl" class="result-image" :src="result.imageUrl" :alt="t('imagePreviewAlt')" />
      <pre v-else-if="result.bodyText">{{ result.bodyText }}</pre>
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
.result-error {
  margin: 0;
}

.panel__eyebrow {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel h3 {
  margin: 0.2rem 0 0;
}

.preset-row,
.method-row__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.method-row {
  display: grid;
  gap: 0.4rem;
}

.method-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.method-chip--active {
  background: rgba(212, 160, 23, 0.18);
  border-color: var(--border-strong);
}

.result-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.result-meta dt {
  color: var(--muted);
  font-size: 0.82rem;
}

.result-meta dd {
  margin: 0.2rem 0 0;
}

.result-error {
  color: var(--muted);
}

.result-image {
  max-width: min(100%, 20rem);
  border-radius: 0.75rem;
  border: 1px solid var(--border);
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
  font-size: 0.82rem;
}
</style>
