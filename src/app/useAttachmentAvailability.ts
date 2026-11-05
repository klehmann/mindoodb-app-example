import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import {
  describeAttachmentAvailability,
  type MindooDBAppAttachmentAvailability,
  type MindooDBAppAttachmentAvailabilityDisplay,
  type MindooDBAppAttachmentAvailabilitySubscription,
  type MindooDBAppAttachmentStorage,
  type MindooDBAppDatabase,
} from "mindoodb-app-sdk";

export interface UseAttachmentAvailabilityOptions {
  database: Ref<MindooDBAppDatabase | null>;
  /** Document whose attachments the panel lists. */
  docId: Ref<string | null>;
  /** Attachment ids of the document, so a new upload or removal re-reads the states. */
  attachmentIds: Ref<readonly string[]>;
  /** UI language for the SDK's tooltip and menu texts. */
  locale: Ref<string>;
  /** Reports a failed pin/unpin to the user. */
  onError?(message: string): void;
}

/**
 * Whether the active document's attachments are on this device.
 *
 * Databases that sync attachments "on demand" (Haven sync target setting)
 * keep only the user's own and pinned files locally; the rest is read from
 * the server when opened. This composable reads `attachmentStorage` from the
 * database, asks Haven for every attachment's state, follows download
 * progress, and pins or unpins single files or the whole document.
 *
 * For `local` and `remote` storage (and hosts without pins) it stays inactive:
 * `enabled` is false and nothing is marked, as the concept asks.
 */
export function useAttachmentAvailability(options: UseAttachmentAvailabilityOptions) {
  const storage = ref<MindooDBAppAttachmentStorage | undefined>(undefined);
  const rows = shallowRef<ReadonlyMap<string, MindooDBAppAttachmentAvailability>>(new Map());
  const documentPinned = ref(false);
  const pinBusy = ref(false);
  let subscription: MindooDBAppAttachmentAvailabilitySubscription | null = null;
  let generation = 0;

  /** Pinning only makes a difference when files are not all on the device anyway. */
  const enabled = computed(() => storage.value === "onDemand");
  /** Files are read from the server (on demand or a server database). */
  const serverBacked = computed(() => storage.value === "onDemand" || storage.value === "remote");

  function setRow(row: MindooDBAppAttachmentAvailability) {
    const next = new Map(rows.value);
    next.set(row.attachmentId, row);
    rows.value = next;
  }

  async function disposeSubscription() {
    const current = subscription;
    subscription = null;
    await current?.dispose().catch(() => undefined);
  }

  async function refresh() {
    const database = options.database.value;
    const docId = options.docId.value;
    const token = generation;
    if (!database || !docId || !enabled.value) {
      rows.value = new Map();
      documentPinned.value = false;
      return;
    }
    try {
      const [states, pins] = await Promise.all([
        database.attachments.availability([{ docId }]),
        database.attachments.listPins(),
      ]);
      if (token !== generation || docId !== options.docId.value) return;
      rows.value = new Map(states.filter((row) => row.docId === docId).map((row) => [row.attachmentId, row]));
      documentPinned.value = pins.some((pin) => pin.docId === docId && !pin.attachmentId);
    } catch {
      // Hosts without pins answer "local"; any other failure just shows nothing.
      if (token === generation) rows.value = new Map();
    }
  }

  watch(
    options.database,
    async (database) => {
      generation += 1;
      const token = generation;
      await disposeSubscription();
      storage.value = undefined;
      rows.value = new Map();
      documentPinned.value = false;
      if (!database) return;
      try {
        const info = await database.info();
        if (token !== generation) return;
        storage.value = info.attachmentStorage ?? "local";
      } catch {
        return;
      }
      if (!enabled.value) return;
      try {
        const next = await database.attachments.onAvailabilityChange((row) => {
          if (row.docId === options.docId.value) setRow(row);
        });
        if (token !== generation) {
          await next.dispose().catch(() => undefined);
          return;
        }
        subscription = next;
      } catch {
        // No push channel: states still come from refresh().
      }
      await refresh();
    },
    { immediate: true },
  );

  watch(
    () => [options.docId.value, options.attachmentIds.value.join("\n")],
    () => {
      void refresh();
    },
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      generation += 1;
      void disposeSubscription();
    });
  }

  function availabilityOf(attachmentId: string): MindooDBAppAttachmentAvailability | null {
    return rows.value.get(attachmentId) ?? null;
  }

  /** Icon, tooltip, progress and pin action for one row; null where nothing is shown. */
  function displayOf(attachmentId: string): MindooDBAppAttachmentAvailabilityDisplay | null {
    if (!enabled.value) return null;
    const row = availabilityOf(attachmentId);
    return row ? describeAttachmentAvailability(row, storage.value, options.locale.value) : null;
  }

  /** The file has to come from the server to be opened. */
  function isNotOnDevice(attachmentId: string): boolean {
    if (storage.value === "remote") return true;
    const state = availabilityOf(attachmentId)?.state;
    return enabled.value && state !== undefined && state !== "local";
  }

  async function runPinAction(action: () => Promise<unknown>) {
    pinBusy.value = true;
    try {
      await action();
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      pinBusy.value = false;
      await refresh();
    }
  }

  /** Pin or unpin one attachment, as the row's menu action says. */
  async function togglePin(attachmentId: string) {
    const database = options.database.value;
    const docId = options.docId.value;
    const row = availabilityOf(attachmentId);
    if (!database || !docId || !row) return;
    await runPinAction(() =>
      row.pinned && !documentPinned.value
        ? database.attachments.unpin(docId, attachmentId)
        : database.attachments.pin(docId, attachmentId),
    );
  }

  /** Keep every attachment of the document offline, also ones added later, or stop doing so. */
  async function toggleDocumentPin() {
    const database = options.database.value;
    const docId = options.docId.value;
    if (!database || !docId) return;
    const pinned = documentPinned.value;
    await runPinAction(async () => {
      if (pinned) {
        await database.attachments.unpin(docId);
        // Single-file pins of this document go too, so "stop" means stop.
        const pins = await database.attachments.listPins();
        for (const pin of pins) {
          if (pin.docId === docId && pin.attachmentId) {
            await database.attachments.unpin(docId, pin.attachmentId);
          }
        }
      } else {
        await database.attachments.pin(docId);
      }
    });
  }

  /** Bytes of the document's attachments that are not on the device yet. */
  const missingBytes = computed(() => {
    let total = 0;
    for (const row of rows.value.values()) {
      if (row.state !== "local") total += Math.max(0, row.size - row.bytesLocal);
    }
    return total;
  });

  return {
    storage,
    enabled,
    serverBacked,
    documentPinned,
    pinBusy,
    missingBytes,
    availabilityOf,
    displayOf,
    isNotOnDevice,
    refresh,
    togglePin,
    toggleDocumentPin,
  };
}
