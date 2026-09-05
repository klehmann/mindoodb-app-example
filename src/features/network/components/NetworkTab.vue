<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";

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
}
</script>

<template>
  <section class="tab-section">
    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Network probe</p>
          <h3>Try a URL the way the browser would</h3>
        </div>
      </div>
      <p class="panel__copy">
        This tab only fires the request. Haven enforces the hosted-app network allowlist.
        In hosted mode, Open-Meteo is typically listed; httpbin is not. A failure there is
        the allowlist, not CORS — httpbin sends <code>Access-Control-Allow-Origin: *</code>.
      </p>

      <div class="preset-row">
        <Button
          label="Allowed (Open-Meteo)"
          severity="secondary"
          size="small"
          @click="applyPreset(NETWORK_PRESET_ALLOWED)"
        />
        <Button
          label="Blocked by Haven, not CORS (httpbin)"
          severity="secondary"
          size="small"
          @click="applyPreset(NETWORK_PRESET_BLOCKED)"
        />
      </div>

      <label class="field">
        <span>URL</span>
        <input v-model="url" class="native-input" type="url" spellcheck="false" />
      </label>

      <div class="method-row">
        <span>Method</span>
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

      <Button label="Send request" icon="pi pi-send" :loading="busy" :disabled="busy" @click="runProbe" />
    </section>

    <section v-if="result" class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Result</p>
          <h3>{{ result.ok ? "Request completed" : "Request failed" }}</h3>
        </div>
        <Tag :value="result.ok ? 'ok' : 'blocked'" :severity="result.ok ? 'success' : 'warn'" rounded />
      </div>
      <dl class="result-meta">
        <div>
          <dt>Status</dt>
          <dd>{{ result.status ?? "—" }}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{{ result.elapsedMs }} ms</dd>
        </div>
      </dl>
      <p v-if="result.error" class="result-error">{{ result.error }}</p>
      <img v-if="result.imageUrl" class="result-image" :src="result.imageUrl" alt="Loaded image preview" />
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
