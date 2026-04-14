/**
 * Events-tab composable for the MindooDB example application.
 *
 * Owns the rolling event log that records theme and viewport push-events
 * from the Haven host.  The root composable calls {@link subscribeToHostEvents}
 * after a successful bridge connection and {@link teardownSubscriptions} during
 * disconnect.
 *
 * Injected dependencies: none -- this composable is self-contained.  The root
 * passes the initial launch context values and the connected session into the
 * subscribe helper.
 *
 * @module useEventsSection
 */
import { ref } from "vue";
import {
  type MindooDBAppHostTheme,
  type MindooDBAppLaunchContext,
  type MindooDBAppSession,
  type MindooDBAppViewport,
} from "mindoodb-app-sdk";

import { applyAppTheme, normalizeAppTheme } from "@/lib/theme";

/**
 * One entry in the Events tab log, recording theme and viewport changes
 * from both the initial launch snapshot and subsequent live updates.
 */
export type DemoEventEntry = {
  id: string;
  kind: "launch-theme" | "launch-viewport" | "theme-changed" | "viewport-changed";
  createdAt: string;
  label: string;
  payload: string;
};

/** Pretty-print any value as indented JSON, defaulting to `{}` for nullish input. */
function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

/** Prepend an event entry to the log, capping at 40 entries to bound memory. */
function addEventEntry(target: DemoEventEntry[], entry: Omit<DemoEventEntry, "id" | "createdAt">) {
  target.unshift({
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  target.splice(40);
}

export function useEventsSection() {
  const hostTheme = ref(normalizeAppTheme());
  const hostViewport = ref<MindooDBAppViewport | null>(null);
  const eventLog = ref<DemoEventEntry[]>([]);

  // ── Host event teardown handles ────────────────────────────────────
  let stopThemeSync: (() => void) | null = null;
  let stopViewportSync: (() => void) | null = null;

  /** Apply a theme from Haven to the PrimeVue runtime and record it in the event log. */
  function applyHostTheme(theme?: MindooDBAppHostTheme | null, kind: DemoEventEntry["kind"] = "theme-changed") {
    hostTheme.value = applyAppTheme(theme);
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-theme" ? "Initial theme" : "Theme changed",
      payload: stringifyJson(theme ?? hostTheme.value),
    });
  }

  /** Store the current iframe viewport and record the event in the log. */
  function setViewport(viewport: MindooDBAppViewport | null, kind: DemoEventEntry["kind"] = "viewport-changed") {
    hostViewport.value = viewport;
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-viewport" ? "Initial viewport" : "Viewport changed",
      payload: stringifyJson(viewport),
    });
  }

  /**
   * Record the initial theme/viewport from the launch context and subscribe
   * to live push-events from the session.
   */
  function subscribeToHostEvents(session: MindooDBAppSession, context: MindooDBAppLaunchContext) {
    eventLog.value = [];
    applyHostTheme(context.theme, "launch-theme");
    setViewport(context.viewport, "launch-viewport");
    stopThemeSync?.();
    stopViewportSync?.();
    stopThemeSync = session.onThemeChange((theme) => {
      applyHostTheme(theme, "theme-changed");
    });
    stopViewportSync = session.onViewportChange((viewport) => {
      setViewport(viewport, "viewport-changed");
    });
  }

  /** Unsubscribe from host events and reset theme to defaults on disconnect. */
  function teardownSubscriptions() {
    stopThemeSync?.();
    stopThemeSync = null;
    stopViewportSync?.();
    stopViewportSync = null;
  }

  /** Reset theme to defaults on connection failure. */
  function resetTheme() {
    applyAppTheme(null);
    hostViewport.value = null;
  }

  return {
    hostTheme,
    hostViewport,
    eventLog,
    subscribeToHostEvents,
    teardownSubscriptions,
    resetTheme,
  };
}
