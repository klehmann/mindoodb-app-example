/**
 * Drag-tab composable: typed copy sources and a drop inspector.
 *
 * Registers a host drag profile on connect. Source cards stay unchanged
 * after a drop — v1 is copy-only.
 *
 * @module useDragSection
 */
import { ref, type Ref } from "vue";
import {
  MINDOODB_APP_WELL_KNOWN_DRAG_TYPES,
  type MindooDBAppDragOffer,
  type MindooDBAppSession,
} from "mindoodb-app-sdk";

export type DemoDragSource = {
  id: string;
  title: string;
  offers: Record<string, string>;
  enabledTypes: string[];
};

export function createDemoDragSources(): DemoDragSource[] {
  return [
    {
      id: "plain",
      title: "Plain text",
      offers: {
        "text/plain": "Notes from the example app",
      },
      enabledTypes: ["text/plain"],
    },
    {
      id: "markdown",
      title: "Markdown",
      offers: {
        "text/plain": "Meeting notes",
        "text/markdown": "## Meeting notes\n\n- **Agenda**\n- Follow-ups for the next chicklet",
      },
      enabledTypes: ["text/plain", "text/markdown"],
    },
    {
      id: "json",
      title: "JSON payload",
      offers: {
        "text/plain": "kind=demo",
        "application/json": JSON.stringify({ kind: "demo", n: 3 }, null, 2),
      },
      enabledTypes: ["text/plain", "application/json"],
    },
    {
      id: "document",
      title: "Document reference",
      offers: {
        "text/plain": "sdkexample / demo-doc-1",
        "application/x-mindoo-document": JSON.stringify({
          databaseId: "sdkexample",
          docId: "demo-doc-1",
        }),
      },
      enabledTypes: ["text/plain", "application/x-mindoo-document"],
    },
  ];
}

export function offersForSource(source: DemoDragSource): MindooDBAppDragOffer[] {
  return source.enabledTypes
    .filter((type) => type in source.offers)
    .map((type) => ({ type, data: source.offers[type]! }));
}

export function useDragSection(session: Ref<MindooDBAppSession | null>) {
  const sources = ref(createDemoDragSources());
  const lastDrop = ref<Record<string, string> | null>(null);
  const hoverActive = ref(false);
  const dragReady = ref(false);
  const unbindBySource = new Map<string, () => void>();

  function teardown() {
    unbindBySource.forEach((unbind) => unbind());
    unbindBySource.clear();
    hoverActive.value = false;
    dragReady.value = false;
  }

  async function install(nextSession: MindooDBAppSession) {
    teardown();
    await nextSession.drag.setProfile({
      accepts: [...MINDOODB_APP_WELL_KNOWN_DRAG_TYPES],
      onOver: (event) => {
        const zone = document.elementFromPoint(event.x, event.y)?.closest("[data-drop-zone]");
        hoverActive.value = Boolean(zone);
        return {
          accept: Boolean(zone),
          effect: zone ? "copy" : "forbidden",
        };
      },
      onLeave: () => {
        hoverActive.value = false;
      },
      onDrop: (event) => {
        lastDrop.value = { ...event.items };
        hoverActive.value = false;
      },
    });
    dragReady.value = true;
  }

  function bindSourceCard(element: HTMLElement | null, sourceId: string) {
    if (!element || !session.value) {
      return;
    }
    unbindBySource.get(sourceId)?.();
    const unbind = session.value.drag.bindSource(element, {
      offers: () => {
        const source = sources.value.find((entry) => entry.id === sourceId);
        return source ? offersForSource(source) : [];
      },
    });
    unbindBySource.set(sourceId, unbind);
  }

  function toggleType(sourceId: string, type: string, enabled: boolean) {
    const source = sources.value.find((entry) => entry.id === sourceId);
    if (!source) {
      return;
    }
    if (enabled && !source.enabledTypes.includes(type)) {
      source.enabledTypes.push(type);
      return;
    }
    if (!enabled) {
      source.enabledTypes = source.enabledTypes.filter((entry) => entry !== type);
    }
  }

  return {
    sources,
    lastDrop,
    hoverActive,
    dragReady,
    install,
    teardown,
    bindSourceCard,
    toggleType,
  };
}
