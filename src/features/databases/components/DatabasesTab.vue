<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";

import JsonCodeEditor from "@/shared/components/JsonCodeEditor.vue";

const props = defineProps<{
  app: any;
}>();

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value: number | string | undefined) {
  if (value == null) {
    return "n/a";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
}

function handleDatabaseChange(event: Event) {
  const databaseId = (event.target as HTMLSelectElement).value;
  if (databaseId) {
    void props.app.selectDatabase(databaseId);
  }
}

function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  void props.app.uploadAttachments(input.files);
  input.value = "";
}
</script>

<template>
  <section class="tab-section">
    <div class="section-toolbar">
      <label class="field">
        <span class="field__label">Selected database</span>
        <select class="native-input" :value="app.selectedDatabaseId ?? ''" @change="handleDatabaseChange">
          <option disabled value="">Select database</option>
          <option v-for="database in app.databases" :key="database.id" :value="database.id">
            {{ database.title }} ({{ database.id }})
          </option>
        </select>
      </label>

      <div v-if="app.selectedDatabaseInfo" class="capability-list">
        <Tag
          v-for="capability in app.selectedDatabaseInfo.capabilities"
          :key="capability"
          :value="capability"
          severity="secondary"
          rounded
        />
      </div>
    </div>

    <div v-if="!app.selectedDatabaseInfo" class="glass-card empty-state">
      Pick a database to browse its documents, history, and attachments.
    </div>

    <div v-else-if="!app.canRead" class="glass-card empty-state">
      This database mapping is not readable from the app.
    </div>

    <div v-else class="database-layout">
      <section class="glass-card panel">
        <div class="panel__header">
          <div>
            <p class="panel__eyebrow">Documents</p>
            <h3>Database contents</h3>
          </div>
          <div class="panel__actions">
            <Button label="Refresh" severity="secondary" text @click="app.refreshDocuments(app.selectedDocumentId)" />
            <Button label="New" icon="pi pi-plus" :disabled="!app.canCreate" @click="app.startCreateDocument" />
          </div>
        </div>

        <div v-if="app.documents.length" class="document-list">
          <button
            v-for="document in app.documents"
            :key="document.id"
            class="document-card"
            :class="{ 'document-card--active': document.id === app.selectedDocumentId }"
            @click="app.selectDocument(document.id)"
          >
            <strong>{{ document.id }}</strong>
            <span>Updated: {{ formatDate(document.updatedAt) }}</span>
            <span>{{ document.attachments?.length ?? 0 }} attachment(s)</span>
          </button>
        </div>
        <p v-else class="panel__empty">No documents were returned for this database yet.</p>
      </section>

      <section class="glass-card panel panel--editor">
        <div class="panel__header">
          <div>
            <p class="panel__eyebrow">Editor</p>
            <h3>{{ app.editorMode === "create" ? "Create document" : "Edit document" }}</h3>
          </div>
          <div class="panel__actions">
            <Button
              label="Save"
              icon="pi pi-save"
              :disabled="app.isBusy || (app.editorMode === 'create' ? !app.canCreate : !app.canUpdate)"
              @click="app.saveDocument"
            />
            <Button
              label="Delete"
              icon="pi pi-trash"
              severity="danger"
              text
              :disabled="!app.selectedDocumentId || !app.canDelete || app.isBusy"
              @click="app.deleteDocument"
            />
          </div>
        </div>

        <JsonCodeEditor v-model="app.editorJson" :min-height="360" />
      </section>

      <section class="side-stack">
        <section class="glass-card panel">
          <div class="panel__header">
            <div>
              <p class="panel__eyebrow">History</p>
              <h3>Revision browser</h3>
            </div>
            <Button
              label="Load history"
              severity="secondary"
              text
              :disabled="!app.selectedDocumentId || app.isBusy"
              @click="app.loadHistory()"
            />
          </div>

          <Message v-if="app.historyMessage" severity="secondary" :closable="false">
            {{ app.historyMessage }}
          </Message>

          <div v-else-if="app.historyEntries.length" class="history-layout">
            <div class="history-list">
              <button
                v-for="entry in app.historyEntries"
                :key="entry.timestamp"
                class="history-item"
                @click="app.loadHistory(entry.timestamp)"
              >
                <strong>{{ formatDate(entry.timestamp) }}</strong>
                <span>{{ entry.identityLabel || entry.publicKeyFingerprint || entry.publicKey }}</span>
                <span>{{ entry.isDeleted ? "Deleted" : entry.isCurrent ? "Current revision" : entry.summary || "Historical snapshot" }}</span>
              </button>
            </div>
            <JsonCodeEditor
              :model-value="formatJson(app.selectedHistoricalDocument)"
              :read-only="true"
              :min-height="220"
            />
          </div>
          <p v-else class="panel__empty">Load history to inspect the available revisions for the selected document.</p>
        </section>

        <section class="glass-card panel">
          <div class="panel__header">
            <div>
              <p class="panel__eyebrow">Attachments</p>
              <h3>Files</h3>
            </div>
            <label class="upload-button">
              <input
                class="sr-only"
                type="file"
                multiple
                :disabled="!app.selectedDocumentId || !app.canUseAttachments || app.isBusy"
                @change="handleUpload"
              />
              <span>Upload</span>
            </label>
          </div>

          <Message v-if="app.attachmentMessage" severity="secondary" :closable="false">
            {{ app.attachmentMessage }}
          </Message>

          <div v-else-if="app.attachments.length" class="attachment-list">
            <article v-for="attachment in app.attachments" :key="attachment.attachmentId" class="attachment-item">
              <div>
                <strong>{{ attachment.fileName }}</strong>
                <p>{{ attachment.mimeType }} · {{ attachment.size }} bytes</p>
              </div>
              <div class="panel__actions">
                <Button
                  label="Preview"
                  size="small"
                  severity="secondary"
                  text
                  :disabled="!app.canPreviewAttachment(attachment.fileName, attachment.mimeType)"
                  @click="app.previewAttachment(attachment.fileName)"
                />
                <Button
                  label="Extract"
                  size="small"
                  severity="secondary"
                  @click="app.downloadAttachment(attachment.fileName)"
                />
                <Button
                  label="Remove"
                  size="small"
                  severity="danger"
                  text
                  @click="app.removeAttachment(attachment.fileName)"
                />
              </div>
            </article>
          </div>
          <p v-else class="panel__empty">No attachments are stored for the current document.</p>
        </section>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tab-section {
  display: grid;
  gap: 1rem;
}

.section-toolbar,
.capability-list,
.panel__header,
.panel__actions,
.history-item,
.attachment-item {
  display: flex;
  gap: 0.75rem;
}

.section-toolbar,
.panel__header,
.attachment-item {
  justify-content: space-between;
  align-items: center;
}

.database-layout {
  display: grid;
  grid-template-columns: minmax(16rem, 20rem) minmax(0, 1.25fr) minmax(20rem, 0.9fr);
  gap: 1rem;
}

.side-stack,
.panel,
.history-layout {
  display: grid;
  gap: 1rem;
}

.panel {
  min-height: 0;
}

.panel--editor {
  min-height: 35rem;
}

.panel__eyebrow,
.field__label {
  margin: 0 0 0.25rem;
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel__header h3,
.attachment-item p,
.panel__empty {
  margin: 0;
}

.document-list,
.history-list,
.attachment-list {
  display: grid;
  gap: 0.75rem;
}

.document-card,
.history-item {
  width: 100%;
  padding: 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  color: inherit;
  text-align: left;
  cursor: pointer;
  flex-direction: column;
  align-items: flex-start;
}

.document-card--active {
  border-color: var(--border-strong);
  box-shadow: inset 0 0 0 1px rgba(212, 160, 23, 0.25);
}

.upload-button {
  position: relative;
  display: inline-flex;
  padding: 0.6rem 0.9rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.native-input {
  min-width: 15rem;
}

.sr-only {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}

.empty-state {
  padding: 1.4rem;
  color: var(--muted);
}

@media (max-width: 1080px) {
  .database-layout {
    grid-template-columns: 1fr;
  }
}
</style>
