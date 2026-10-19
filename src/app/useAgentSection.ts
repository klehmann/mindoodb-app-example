/**
 * Agent-tab composable: offers the example's agent tools to Haven and keeps
 * the agent context current.
 *
 * - Once a session exists, `session.agent.registerTools()` declares the tools
 *   from `createExampleAgentTools`. Their `execute` functions read the app
 *   state lazily, so one registration covers database switches.
 * - Haven's answer says which names agents see (`example_documents_list`)
 *   and whether agents may call them right now (`enabled`): only while the
 *   user has switched on Agent tools in Haven's settings and allowed this app.
 *   Neither can be set from the app, so the Agent tab just shows the state.
 * - `session.agent.setContext()` publishes what the user sees (database,
 *   selected document); agents read it through `haven_get_context` and our
 *   own `example_get_context`.
 * - Hosts that predate agent tools have no `session.agent`; then nothing
 *   happens.
 *
 * @module useAgentSection
 */
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type {
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
  MindooDBAppLaunchContext,
  MindooDBAppSession,
} from "mindoodb-app-sdk";

import { createAgentUndo } from "@/features/agent/lib/agentUndo";
import { createExampleAgentTools } from "@/features/agent/lib/exampleAgentTools";
import { t, tn } from "@/i18n";

const CONTEXT_DEBOUNCE_MS = 300;

export interface UseAgentSectionDeps {
  session: Ref<MindooDBAppSession | null>;
  launchContext: Ref<MindooDBAppLaunchContext | null>;
  selectedDatabase: Ref<MindooDBAppDatabase | null>;
  selectedDatabaseInfo: ComputedRef<MindooDBAppDatabaseInfo | null>;
  isTimeTravelActive: ComputedRef<boolean>;
  selectedDocumentId: Ref<string | null>;
  /** Field names seen in the listed documents. */
  knownFields: Ref<string[]>;
  fulltextEnabled: ComputedRef<boolean>;
  indexedFields: Ref<string[]>;
  /** Reload the document list (selecting `docId`) and any open view after an agent write. */
  afterWrite: (docId: string | null) => Promise<void>;
}

export function useAgentSection(deps: UseAgentSectionDeps) {
  /** Shown in the Agent tab. */
  const exposedToolNames = ref<string[]>([]);
  const agentToolsEnabled = ref(false);
  /** Empty until registration answers; the Agent tab then shows `agentNotRegistered`. */
  const agentToolsStatus = ref("");
  const agentUndo = createAgentUndo();

  /** Small and semantic: what an agent needs to resolve "this document". Not a UI dump. */
  const context = computed(() => {
    const info = deps.selectedDatabaseInfo.value;
    return {
      database: info ? { databaseId: info.id, title: info.title, capabilities: info.capabilities } : null,
      readOnly: deps.isTimeTravelActive.value,
      fulltextIndex: deps.fulltextEnabled.value
        ? { enabled: true, fields: deps.indexedFields.value.length ? deps.indexedFields.value : "all" }
        : { enabled: false },
      fieldNames: deps.knownFields.value,
      selectedDocId: deps.selectedDocumentId.value,
    };
  });

  const tools = createExampleAgentTools({
    database: () => deps.selectedDatabase.value,
    context: () => context.value,
    readOnly: () => deps.isTimeTravelActive.value,
    decryptionKeyId: () => deps.launchContext.value?.launchParameters.decryptionKeyId?.trim() || "default",
    undo: agentUndo,
    afterWrite: deps.afterWrite,
    searchUsers: async (query, limit) => {
      const database = deps.selectedDatabase.value;
      // The directory needs its own permission on the database mapping.
      if (!database?.directory || !deps.selectedDatabaseInfo.value?.capabilities.includes("directory")) {
        return null;
      }
      return (await database.directory.listUsers({ query, limit })).users;
    },
  });

  watch(
    deps.session,
    async (session) => {
      if (!session) {
        exposedToolNames.value = [];
        agentToolsEnabled.value = false;
        return;
      }
      if (!session.agent) {
        agentToolsStatus.value = t("agentNoHostSupport");
        return;
      }
      try {
        const registration = await session.agent.registerTools(tools);
        exposedToolNames.value = registration.exposedNames;
        agentToolsEnabled.value = registration.enabled;
        agentToolsStatus.value = registration.enabled
          ? tn("agentToolsOffered", registration.exposedNames.length)
          : t("agentToolsDeclared");
        await session.agent.setContext(context.value);
      } catch (error) {
        agentToolsStatus.value = t("agentOfferFailed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    { immediate: true },
  );

  // Keep the context current, debounced: selection changes come in bursts.
  let contextTimer: ReturnType<typeof setTimeout> | null = null;
  watch(
    () => JSON.stringify(context.value),
    () => {
      if (contextTimer) clearTimeout(contextTimer);
      contextTimer = setTimeout(() => {
        contextTimer = null;
        void deps.session.value?.agent?.setContext(context.value).catch(() => undefined);
      }, CONTEXT_DEBOUNCE_MS);
    },
  );

  return {
    agentTools: tools,
    exposedToolNames,
    agentToolsEnabled,
    agentToolsStatus,
    agentSteps: agentUndo.steps,
  };
}
