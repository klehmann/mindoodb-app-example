<script setup lang="ts">
/**
 * "Embedded editors" tab. Thin UI over `useEmbedsSection`: the editor cards, the
 * list of documents in `sdkexample`, and the panel the editor is shown in.
 */
import { ref, watch, type UnwrapNestedRefs } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";

import type { EmbeddedEditorStatus, useEmbedsSection } from "@/app/useEmbedsSection";
import type { EmbeddedEditorKind } from "@/features/embeds/lib/embeddedEditors";

const props = defineProps<{
  app: { embeds: UnwrapNestedRefs<ReturnType<typeof useEmbedsSection>> };
  /** Whether this tab is in front. The tab stays mounted (v-show) so the editor keeps running. */
  active: boolean;
}>();

// A hidden editor gets no drops of host-owned drags, and on Havens that lay it over
// the page instead of framing it, it would otherwise stay visible above other tabs.
watch(
  () => props.active,
  (active) => void props.app.embeds.setEditorVisible(active),
  { immediate: true },
);

/**
 * The element the editor goes in. It is always rendered (v-show, not v-if) and
 * positioned, because the SDK puts the editor's frame into it with `inset: 0`.
 */
const editorPanel = ref<HTMLElement | null>(null);
const newTitle = ref("");
const renaming = ref<{ docId: string; title: string } | null>(null);
/**
 * Set while the open editor has unsaved changes and the user must choose what to
 * do: then `next` runs (open another document, create one, or nothing).
 */
const pendingClose = ref<{ next: () => Promise<unknown> } | null>(null);

function statusLabel(editor: EmbeddedEditorStatus) {
  if (!editor.component) return "Not installed";
  if (editor.access === "granted") return "Ready";
  if (editor.access === "pending") return "Asks on open";
  return "Asks on first open";
}

function statusSeverity(editor: EmbeddedEditorStatus) {
  if (!editor.component) return "danger";
  return editor.access === "granted" ? "success" : "warn";
}

function editorOf(kind: EmbeddedEditorKind) {
  return props.app.embeds.editors.find((editor) => editor.kind === kind)!;
}

/** Runs `next` once the current editor is closed, asking first about unsaved changes. */
async function afterClose(next: () => Promise<unknown>) {
  const result = await props.app.embeds.closeEditor("ask");
  if (result === "confirm") {
    pendingClose.value = { next };
  } else if (result === "closed") {
    await next();
  }
}

async function resolveClose(mode: "save" | "discard" | "cancel") {
  const pending = pendingClose.value;
  pendingClose.value = null;
  if (!pending || mode === "cancel") return;
  if ((await props.app.embeds.closeEditor(mode)) === "closed") {
    await pending.next();
  }
}

function create(kind: EmbeddedEditorKind) {
  const title = newTitle.value.trim() || `New ${editorOf(kind).noun.toLowerCase()}`;
  void afterClose(async () => {
    await props.app.embeds.createDocument(kind, title, editorPanel.value!);
    newTitle.value = "";
  });
}

function open(docId: string) {
  void afterClose(() => props.app.embeds.openInEditor(docId, editorPanel.value!));
}

async function saveRename() {
  const current = renaming.value;
  renaming.value = null;
  if (current?.title.trim()) {
    await props.app.embeds.renameDocument(current.docId, current.title.trim());
  }
}

async function remove(docId: string, title: string) {
  if (window.confirm(`Delete "${title || "Untitled"}" and everything that belongs to it?`)) {
    await props.app.embeds.deleteDocument(docId);
  }
}
</script>

<template>
  <section class="tab-section">
    <Message v-if="!app.embeds.embedsSupported" severity="warn" :closable="false">
      This Haven cannot embed editors of other apps yet. Update Haven to try this tab.
    </Message>
    <!-- While an editor is open, notices go below it (see the comment at the confirm buttons). -->
    <Message v-if="app.embeds.notice && !app.embeds.openDocId" severity="warn" :closable="false">
      {{ app.embeds.notice }}
    </Message>

    <section class="glass-card panel">
      <div>
        <p class="panel__eyebrow">Editors of other apps</p>
        <h3>Create Word documents, spreadsheets and presentations in this app's database</h3>
        <p class="panel__hint">
          TeamEdit, TeamGrid and TeamSlides offer their editors as components. This app shows them below; the
          documents are stored in <code>sdkexample</code>, not in the other apps' databases.
        </p>
      </div>

      <div class="editor-grid">
        <article v-for="editor in app.embeds.editors" :key="editor.kind" class="editor-card">
          <div class="editor-card__title">
            <strong>{{ editor.component?.label ?? editor.noun }}</strong>
            <Tag :value="statusLabel(editor)" :severity="statusSeverity(editor)" rounded />
          </div>
          <small v-if="!editor.component">
            Install {{ editor.appName }} in Haven, then reload this app.
          </small>
          <small v-else-if="editor.access !== 'granted'">
            {{ editor.component.appLabel }} has not been allowed to open this app's documents yet. Haven asks when
            you open or create one.
          </small>
          <small v-else>Provided by {{ editor.component.appLabel }}.</small>
          <Button
            :label="`New ${editor.noun.toLowerCase()}`"
            icon="pi pi-plus"
            size="small"
            :disabled="!editor.component || !app.embeds.canEdit || app.embeds.busy"
            @click="create(editor.kind)"
          />
        </article>
      </div>

      <label class="field">
        <span class="field__label">Title for the next new document (optional)</span>
        <input v-model="newTitle" class="native-input" placeholder="e.g. Budget 2027">
      </label>
    </section>

    <section class="glass-card panel">
      <p class="panel__eyebrow">Stored in sdkexample</p>
      <p v-if="!app.embeds.embeddedDocuments.length" class="panel__empty">
        No documents yet. Create one above.
      </p>
      <ul v-else class="doc-list">
        <li
          v-for="row in app.embeds.embeddedDocuments"
          :key="row.docId"
          class="doc-row"
          :class="{ 'doc-row--open': row.docId === app.embeds.openDocId }"
        >
          <Tag :value="editorOf(row.kind).noun" severity="secondary" rounded />
          <form v-if="renaming?.docId === row.docId" class="doc-row__rename" @submit.prevent="saveRename">
            <input v-model="renaming.title" class="native-input" aria-label="New title">
            <Button type="submit" label="Save" size="small" />
            <Button label="Cancel" size="small" severity="secondary" text @click="renaming = null" />
          </form>
          <span v-else class="doc-row__title">{{ row.title || "Untitled" }}</span>
          <div class="doc-row__actions">
            <Button label="Open" size="small" :disabled="row.docId === app.embeds.openDocId || app.embeds.busy" @click="open(row.docId)" />
            <Button
              label="Rename"
              size="small"
              severity="secondary"
              :disabled="!app.embeds.canEdit || row.docId === app.embeds.openDocId"
              :title="row.docId === app.embeds.openDocId ? 'Rename it in the editor while it is open' : undefined"
              @click="renaming = { docId: row.docId, title: row.title }"
            />
            <Button
              label="Delete"
              size="small"
              severity="danger"
              text
              :disabled="!app.embeds.canEdit"
              @click="remove(row.docId, row.title)"
            />
          </div>
        </li>
      </ul>
    </section>

    <section class="glass-card panel">
      <div class="panel__header">
        <div>
          <p class="panel__eyebrow">Editor</p>
          <h3>
            {{ app.embeds.openDocument?.title || (app.embeds.openDocId ? "Untitled" : "No document open") }}
            <Tag v-if="app.embeds.openDirty" value="Unsaved changes" severity="warn" rounded />
          </h3>
        </div>
        <!--
          The question about unsaved changes takes the place of the buttons instead of
          pushing the editor down: on Havens that lay the editor over the page
          (placement "overlay") it follows its element's size and scrolling, not
          layout shifts.
        -->
        <div v-if="pendingClose" class="confirm" role="alertdialog" aria-label="Unsaved changes">
          <span>Save changes first?</span>
          <Button label="Save" size="small" @click="resolveClose('save')" />
          <Button label="Don't save" size="small" severity="danger" @click="resolveClose('discard')" />
          <Button label="Cancel" size="small" severity="secondary" text @click="resolveClose('cancel')" />
        </div>
        <div v-else-if="app.embeds.openDocId" class="doc-row__actions">
          <Button label="Save" icon="pi pi-save" size="small" :disabled="!app.embeds.canEdit" @click="app.embeds.saveEditor()" />
          <Button label="Close" icon="pi pi-times" size="small" severity="secondary" @click="afterClose(async () => {})" />
        </div>
      </div>

      <div class="editor-panel">
        <div ref="editorPanel" class="editor-panel__frame" />
        <p v-show="!app.embeds.openDocId" class="panel__empty editor-panel__empty">
          Open or create a document: its editor appears here.
        </p>
      </div>
      <Message v-if="app.embeds.notice && app.embeds.openDocId" severity="warn" :closable="false">
        {{ app.embeds.notice }}
      </Message>
    </section>
  </section>
</template>

<style scoped>
.tab-section,
.panel,
.editor-grid,
.editor-card,
.doc-list {
  display: grid;
  gap: 1rem;
}

.editor-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.editor-card,
.doc-row {
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
}

.editor-card {
  gap: 0.6rem;
  align-content: start;
}

.editor-card small,
.panel__hint {
  color: var(--muted);
}

.editor-card__title,
.doc-row,
.doc-row__rename,
.doc-row__actions,
.confirm,
.panel__header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.editor-card__title,
.panel__header {
  justify-content: space-between;
}

.panel__hint,
h3 {
  margin: 0.3rem 0 0;
}

.doc-list {
  margin: 0;
  padding: 0;
  list-style: none;
  gap: 0.5rem;
}

.doc-row__title,
.doc-row__rename {
  flex: 1;
}

.doc-row--open {
  border-color: var(--border-strong);
}

/* The SDK fills this element with the editor's frame (`position: absolute; inset: 0`). */
.editor-panel {
  position: relative;
  height: min(75vh, 720px);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.editor-panel__frame {
  position: absolute;
  inset: 0;
}

.editor-panel__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

@media (max-width: 820px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }

  .doc-row {
    flex-wrap: wrap;
  }
}
</style>
