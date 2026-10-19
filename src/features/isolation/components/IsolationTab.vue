<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";

import {
  currentHostingMode,
  describeExpectation,
  type IsolationProbe,
  type IsolationProbeId,
  type IsolationProbeResult,
  runIsolationProbe,
  batchProbes,
  safeProbes,
  sessionEndingProbes,
  summarizeIsolationResults,
} from "@/features/isolation/lib/isolationProbes";
import { formatTime, segments, t, tn } from "@/i18n";

interface RecordedViolation {
  directive: string;
  blockedUri: string;
  at: string;
}

const hosting = currentHostingMode();
const safe = safeProbes();
const batch = batchProbes();
const destructive = sessionEndingProbes();

const results = ref<Map<IsolationProbeId, IsolationProbeResult>>(new Map());
const running = ref<IsolationProbeId | null>(null);
const runningAll = ref(false);
const violations = ref<RecordedViolation[]>([]);

const summary = computed(() => summarizeIsolationResults([...results.value.values()]));
const hasResults = computed(() => results.value.size > 0);

/**
 * CSP reports the violation on the document whose policy was broken. That means
 * this listener sees the nested-iframe and form-action probes, but never the
 * self-navigation ones — those are refused by the wrapper's policy, one frame
 * up, where this app has no reach.
 */
function onViolation(event: SecurityPolicyViolationEvent) {
  violations.value = [
    {
      directive: event.violatedDirective,
      blockedUri: event.blockedURI || t("emptyValue"),
      at: formatTime(Date.now()),
    },
    ...violations.value,
  ].slice(0, 20);
}

onMounted(() => {
  document.addEventListener("securitypolicyviolation", onViolation);
});

onBeforeUnmount(() => {
  document.removeEventListener("securitypolicyviolation", onViolation);
});

async function run(probe: IsolationProbe) {
  running.value = probe.id;
  try {
    const result = await runIsolationProbe(probe.id);
    results.value = new Map(results.value).set(probe.id, result);
  } finally {
    running.value = null;
  }
}

async function runSafe() {
  runningAll.value = true;
  try {
    for (const probe of batch) {
      await run(probe);
    }
  } finally {
    runningAll.value = false;
  }
}

function reset() {
  results.value = new Map();
  violations.value = [];
}

function resultFor(id: IsolationProbeId) {
  return results.value.get(id) ?? null;
}

function outcomeSeverity(outcome: IsolationProbeResult["outcome"]) {
  if (outcome === "contained") {
    return "success";
  }
  return outcome === "escaped" ? "danger" : "warn";
}

function outcomeLabel(outcome: IsolationProbeResult["outcome"]) {
  if (outcome === "contained") {
    return t("outcomeContained");
  }
  return outcome === "escaped" ? t("outcomeEscaped") : t("outcomeNotCovered");
}
</script>

<template>
  <section class="tab-section">
    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("isoEyebrow") }}</p>
          <h3>{{ t("isoHeading") }}</h3>
        </div>
        <Tag :value="hosting === 'hosted' ? t('hostingHosted') : t('hostingExternal')" :severity="hosting === 'hosted' ? 'success' : 'warn'" rounded />
      </div>
      <p class="panel__copy">
        <template
          v-for="(part, index) in segments('isoIntro', { contained: t('isoIntroContained'), escaped: t('isoIntroEscaped') })"
          :key="index"
        >
          <strong v-if="part.param">{{ part.text }}</strong>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>

      <p class="panel__copy">
        <template v-for="(part, index) in segments('isoRunYourselfCopy', { tag: t('runItYourself') })" :key="index">
          <em v-if="part.param">{{ part.text }}</em>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>

      <Message v-if="hosting === 'external'" severity="warn" :closable="false">
        {{ t("isoExternalWarning") }}
      </Message>

      <div class="action-row">
        <Button
          :label="t('runSafeProbes')"
          icon="pi pi-play"
          :loading="runningAll"
          :disabled="runningAll || running !== null"
          @click="runSafe"
        />
        <Button
          v-if="hasResults"
          :label="t('clear')"
          severity="secondary"
          size="small"
          :disabled="runningAll || running !== null"
          @click="reset"
        />
        <div v-if="hasResults" class="summary">
          <Tag :value="tn('countContained', summary.contained)" severity="success" rounded />
          <Tag v-if="summary.escaped" :value="tn('countEscaped', summary.escaped)" severity="danger" rounded />
          <Tag
            v-if="summary.inconclusive"
            :value="tn('countNotCovered', summary.inconclusive)"
            severity="warn"
            rounded
          />
        </div>
      </div>

      <ul class="probe-list">
        <li v-for="probe in safe" :key="probe.id" class="probe">
          <div class="probe__head">
            <div>
              <p class="probe__label">
                {{ probe.label }}
                <Tag
                  v-if="probe.sendsRealTraffic"
                  :value="t('runItYourself')"
                  severity="warn"
                  rounded
                />
              </p>
              <p class="probe__layer">{{ probe.layer }}</p>
            </div>
            <div class="probe__actions">
              <Tag
                v-if="resultFor(probe.id)"
                :value="outcomeLabel(resultFor(probe.id)!.outcome)"
                :severity="outcomeSeverity(resultFor(probe.id)!.outcome)"
                rounded
              />
              <Button
                :label="t('run')"
                size="small"
                severity="secondary"
                :loading="running === probe.id"
                :disabled="runningAll || running !== null"
                @click="run(probe)"
              />
            </div>
          </div>
          <p class="probe__expectation">{{ describeExpectation(probe, hosting) }}</p>
          <p v-if="resultFor(probe.id)" class="probe__detail">
            {{ resultFor(probe.id)!.detail }}
            <span class="probe__timing">{{ resultFor(probe.id)!.elapsedMs }} ms</span>
          </p>
        </li>
      </ul>
    </section>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("navEyebrow") }}</p>
          <h3>{{ t("navHeading") }}</h3>
        </div>
      </div>
      <p class="panel__copy">
        <template v-for="(part, index) in segments('navCopy', { button: t('runSafeProbes') })" :key="index">
          <em v-if="part.param">{{ part.text }}</em>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <p class="panel__copy panel__copy--muted">
        {{ t("navCopyMuted") }}
      </p>

      <ul class="probe-list">
        <li v-for="probe in destructive" :key="probe.id" class="probe">
          <div class="probe__head">
            <div>
              <p class="probe__label">{{ probe.label }}</p>
              <p class="probe__layer">{{ probe.layer }}</p>
            </div>
            <div class="probe__actions">
              <Tag
                v-if="resultFor(probe.id)"
                :value="outcomeLabel(resultFor(probe.id)!.outcome)"
                :severity="outcomeSeverity(resultFor(probe.id)!.outcome)"
                rounded
              />
              <Button
                :label="t('run')"
                size="small"
                severity="danger"
                outlined
                :loading="running === probe.id"
                :disabled="runningAll || running !== null"
                @click="run(probe)"
              />
            </div>
          </div>
          <p class="probe__expectation">{{ describeExpectation(probe, hosting) }}</p>
          <p v-if="resultFor(probe.id)" class="probe__detail">
            {{ resultFor(probe.id)!.detail }}
            <span class="probe__timing">{{ resultFor(probe.id)!.elapsedMs }} ms</span>
          </p>
        </li>
      </ul>
    </section>

    <section v-if="violations.length" class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">{{ t("cspEyebrow") }}</p>
          <h3>{{ t("cspHeading") }}</h3>
        </div>
      </div>
      <p class="panel__copy">
        {{ t("cspCopy") }}
      </p>
      <ul class="violation-list">
        <li v-for="(violation, index) in violations" :key="`${violation.at}-${index}`">
          <code>{{ violation.directive }}</code>
          <span>{{ violation.blockedUri }}</span>
          <span class="probe__timing">{{ violation.at }}</span>
        </li>
      </ul>
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
.probe__label,
.probe__layer,
.probe__expectation,
.probe__detail {
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

.panel__copy--muted {
  color: var(--muted);
  font-size: 0.88rem;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.summary {
  display: flex;
  gap: 0.4rem;
  margin-left: auto;
}

.probe-list,
.violation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.probe {
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

.probe__head {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.probe__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.probe__label {
  font-weight: 600;
}

.probe__layer {
  color: var(--muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.probe__expectation {
  color: var(--muted);
  font-size: 0.88rem;
}

.probe__detail {
  font-size: 0.88rem;
  font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
  word-break: break-word;
}

.probe__timing {
  color: var(--muted);
  margin-left: 0.5rem;
}

.violation-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.85rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.violation-list li:last-child {
  border-bottom: none;
}
</style>
