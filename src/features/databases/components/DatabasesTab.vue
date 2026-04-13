<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { abbreviateCanonicalName } from "mindoodb-app-sdk";

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

function formatDocumentActor(value: string | undefined) {
  return value ? abbreviateCanonicalName(value) : "";
}

function formatDocumentUpdatedAt(value: number | string | undefined) {
  if (value == null) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
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

function handleSearchInput(event: Event) {
  props.app.setSearchQuery((event.target as HTMLInputElement).value);
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

        <div class="document-controls">
          <label class="field">
            <span class="field__label">Document ID filter</span>
            <input v-model="app.documentIdFilter" class="native-input" type="text" placeholder="Filter document IDs" />
          </label>

          <label class="field">
            <span class="field__label">Full-text search</span>
            <input
              class="native-input"
              type="search"
              :value="app.searchQuery"
              :disabled="!app.hasSearchIndex"
              placeholder="Search indexed fields"
              @input="handleSearchInput"
            />
          </label>

          <div class="field">
            <span class="field__label">Show</span>
            <div class="choice-group">
              <label class="choice">
                <input
                  type="radio"
                  name="document-mode"
                  value="all"
                  :checked="app.documentListMode === 'all'"
                  @change="void app.setDocumentListMode('all')"
                />
                <span>All</span>
              </label>
              <label class="choice">
                <input
                  type="radio"
                  name="document-mode"
                  value="existing"
                  :checked="app.documentListMode === 'existing'"
                  @change="void app.setDocumentListMode('existing')"
                />
                <span>Existing</span>
              </label>
              <label class="choice">
                <input
                  type="radio"
                  name="document-mode"
                  value="deleted"
                  :checked="app.documentListMode === 'deleted'"
                  @change="void app.setDocumentListMode('deleted')"
                />
                <span>Deleted</span>
              </label>
            </div>
          </div>

          <div class="field">
            <span class="field__label">Indexed fields</span>
            <div v-if="app.availableSearchFields.length" class="field-picker">
              <label v-for="field in app.availableSearchFields" :key="field" class="choice">
                <input v-model="app.searchFieldSelection" type="checkbox" :value="field" />
                <span>{{ field }}</span>
              </label>
            </div>
            <p v-else class="panel__empty">Open a readable database with existing documents to discover searchable fields.</p>
          </div>

          <div class="panel__actions">
            <Button
              label="Create Index"
              severity="secondary"
              text
              :disabled="!app.searchFieldSelection.length || app.isBusy"
              @click="app.createSearchIndex(app.searchFieldSelection)"
            />
            <Button
              label="Sync Index"
              severity="secondary"
              text
              :disabled="!app.hasSearchIndex || app.isBusy"
              @click="app.syncSearchIndex"
            />
          </div>

          <Message v-if="app.hasSearchIndex" severity="secondary" :closable="false">
            Indexed {{ app.indexedFields.join(", ") }}<span v-if="app.indexCursor"> · cursor checkpoint ready</span>
          </Message>
          <Message v-if="app.indexStats" severity="info" :closable="false">
            Processed {{ app.indexStats.totalProcessed }} change(s),
            <span v-if="'indexed' in app.indexStats">{{ app.indexStats.indexed }} indexed</span>
            <span v-else>{{ app.indexStats.updated }} updated</span>,
            {{ app.indexStats.deleted }} deleted.
          </Message>
        </div>

        <div v-if="app.documents.length" class="document-list">
          <button
            v-for="document in app.documents"
            :key="document.id"
            class="document-card"
            :class="{ 'document-card--active': document.id === app.selectedDocumentId }"
            @click="void app.selectDocument(document.id)"
          >
            <div class="document-card__header">
              <strong>{{ document.id }}</strong>
              <Tag
                v-if="document.isDeleted"
                value="Deleted"
                severity="danger"
                rounded
              />
            </div>
            <span v-if="document.identityLabel || document.publicKeyFingerprint">
              {{ formatDocumentActor(document.identityLabel ?? document.publicKeyFingerprint) }}
            </span>
            <span>Updated: {{ formatDocumentUpdatedAt(document.updatedAt) }}</span>
            <span>{{ document.attachmentCount ?? 0 }} attachment(s)</span>
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
              :disabled="app.isBusy || !app.canSaveCurrentDocument"
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
                :disabled="!app.selectedDocument || !app.canUseAttachments || app.isBusy"
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

.section-toolbar {
  flex-wrap: wrap;
}

.field {
  flex: 1 1 18rem;
  min-width: 0;
}

.capability-list {
  flex: 1 1 100%;
  flex-wrap: wrap;
}

.panel__header {
  flex-wrap: wrap;
}

.panel__header > :first-child {
  flex: 1 1 16rem;
  min-width: 0;
}

.panel__actions {
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-left: auto;
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
.attachment-list,
.document-controls,
.field-picker,
.choice-group {
  display: grid;
  gap: 0.75rem;
}

.document-card__header,
.choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.document-card,
.history-item {
  display: flex;
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
  width: 100%;
}

.field-picker,
.choice-group {
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
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
