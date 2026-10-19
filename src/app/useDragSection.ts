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

import { t } from "@/i18n";

export type DemoDragSource = {
  id: string;
  /** Getters, so the card follows a language change. */
  readonly title: string;
  readonly offers: Record<string, string>;
  enabledTypes: string[];
};

export function createDemoDragSources(): DemoDragSource[] {
  return [
    {
      id: "plain",
      get title() {
        return t("dragPlainText");
      },
      get offers() {
        return { "text/plain": t("dragSampleText") };
      },
      enabledTypes: ["text/plain"],
    },
    {
      id: "markdown",
      get title() {
        return t("dragMarkdown");
      },
      get offers() {
        return {
          "text/plain": t("dragMeetingNotes"),
          "text/markdown": `## ${t("dragMeetingNotes")}\n\n- **${t("dragMeetingAgenda")}**\n- ${t("dragMeetingFollowUps")}`,
        };
      },
      enabledTypes: ["text/plain", "text/markdown"],
    },
    {
      id: "json",
      get title() {
        return t("dragJson");
      },
      offers: {
        "text/plain": "kind=demo",
        "application/json": JSON.stringify({ kind: "demo", n: 3 }, null, 2),
      },
      enabledTypes: ["text/plain", "application/json"],
    },
    {
      id: "document",
      get title() {
        return t("dragDocument");
      },
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

export function hitDemoDropZone(x: number, y: number) {
  const fromPoint = typeof document.elementFromPoint === "function"
    ? document.elementFromPoint(x, y)?.closest("[data-drop-zone]")
    : null;
  if (fromPoint) {
    return true;
  }
  const zone = document.querySelector("[data-drop-zone]");
  if (!(zone instanceof HTMLElement)) {
    return false;
  }
  const rect = zone.getBoundingClientRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
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
        const zone = hitDemoDropZone(event.x, event.y);
        hoverActive.value = zone;
        return {
          accept: zone,
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
