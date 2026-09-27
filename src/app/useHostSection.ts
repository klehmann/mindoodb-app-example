/**
 * Host-tab composable: focus queries and Haven notices.
 *
 * The published session type may predate these methods, so the tab checks
 * for them at runtime. `pnpm dev:local` resolves the sibling SDK that has them.
 */
import { ref, type Ref } from "vue";
import type { MindooDBAppSession } from "mindoodb-app-sdk";

export const HOST_FOCUS_DELAY_MS = 4_000;
export const HOST_NOTICE_DELAY_MS = 4_000;
export const HOST_PROGRESS_STEP_MS = 1_000;
export const HOST_PROGRESS_NOTICE_ID = "example-progress";
export const HOST_SCHEDULED_NOTICE_ID = "example-scheduled";

export type DemoHostSeverity = "info" | "warning" | "error";

export type DemoHostSession = {
  requestHostFocus(): Promise<void>;
  hasHostFocus(): Promise<boolean>;
  onHostFocusChange(listener: (focused: boolean) => void): () => void;
  notify(input: {
    id?: string;
    severity: DemoHostSeverity;
    text: string;
    durationMs?: number;
  }): Promise<{ id: string }>;
};

export function progressPercents() {
  return Array.from({ length: 11 }, (_, index) => index * 10);
}

export function asDemoHostSession(session: object): DemoHostSession | null {
  const candidate = session as Partial<DemoHostSession>;
  if (
    typeof candidate.requestHostFocus !== "function" ||
    typeof candidate.hasHostFocus !== "function" ||
    typeof candidate.onHostFocusChange !== "function" ||
    typeof candidate.notify !== "function"
  ) {
    return null;
  }
  return candidate as DemoHostSession;
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useHostSection(_session: Ref<MindooDBAppSession | null>) {
  const hostFocused = ref<boolean | null>(null);
  const hostAvailable = ref(false);
  const hostStatus = ref("Connect to Haven to use focus and notices.");
  const hostSeverity = ref<DemoHostSeverity>("info");
  let hostSession: DemoHostSession | null = null;
  let stopFocus: (() => void) | null = null;
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  function clearTimers() {
    if (focusTimer != null) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
    if (noticeTimer != null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (progressTimer != null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function teardown() {
    clearTimers();
    stopFocus?.();
    stopFocus = null;
    hostSession = null;
    hostAvailable.value = false;
    hostFocused.value = null;
  }

  async function refreshFocus() {
    if (!hostSession) {
      return;
    }
    hostFocused.value = await hostSession.hasHostFocus();
  }

  async function install(nextSession: MindooDBAppSession) {
    teardown();
    const resolved = asDemoHostSession(nextSession);
    if (!resolved) {
      hostStatus.value = "This SDK build has no host focus or notices. Run pnpm dev:local.";
      return;
    }
    hostSession = resolved;
    hostAvailable.value = true;
    stopFocus = resolved.onHostFocusChange((focused) => {
      hostFocused.value = focused;
    });
    await refreshFocus();
    hostStatus.value = hostFocused.value
      ? "This launch has host focus."
      : "This launch does not have host focus.";
  }

  async function checkHostFocus() {
    if (!hostSession) {
      return;
    }
    try {
      await refreshFocus();
      hostStatus.value = hostFocused.value
        ? "This launch has host focus."
        : "This launch does not have host focus.";
    } catch (error) {
      hostStatus.value = readErrorMessage(error, "Could not read host focus.");
    }
  }

  async function requestHostFocusNow() {
    if (!hostSession) {
      return;
    }
    try {
      await hostSession.requestHostFocus();
      await refreshFocus();
      hostStatus.value = "Focus requested.";
    } catch (error) {
      hostStatus.value = readErrorMessage(error, "Could not request host focus.");
    }
  }

  function requestHostFocusLater() {
    if (!hostSession) {
      return;
    }
    if (focusTimer != null) {
      clearTimeout(focusTimer);
    }
    hostStatus.value = "Requesting focus in 4 seconds.";
    focusTimer = setTimeout(() => {
      focusTimer = null;
      void requestHostFocusNow();
    }, HOST_FOCUS_DELAY_MS);
  }

  async function notify(text: string, id: string) {
    if (!hostSession) {
      return;
    }
    const result = await hostSession.notify({
      id,
      severity: hostSeverity.value,
      text,
    });
    hostStatus.value = `Notice ${result.id}: ${text}`;
  }

  function startHostProgress() {
    if (!hostSession) {
      return;
    }
    if (progressTimer != null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    const steps = progressPercents();
    let index = 0;
    const send = async () => {
      const percent = steps[index];
      if (percent == null || !hostSession) {
        return;
      }
      try {
        await notify(`${percent}%`, HOST_PROGRESS_NOTICE_ID);
      } catch (error) {
        hostStatus.value = readErrorMessage(error, "Could not show the progress notice.");
        if (progressTimer != null) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      }
    };
    void send();
    progressTimer = setInterval(() => {
      index += 1;
      if (index >= steps.length) {
        if (progressTimer != null) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        return;
      }
      void send();
    }, HOST_PROGRESS_STEP_MS);
  }

  function scheduleHostNotice() {
    if (!hostSession) {
      return;
    }
    if (noticeTimer != null) {
      clearTimeout(noticeTimer);
    }
    hostStatus.value = "A notice will appear in 4 seconds. Leave this app, then click the notice.";
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      void notify("Click this notice to show the example app.", HOST_SCHEDULED_NOTICE_ID).catch((error: unknown) => {
        hostStatus.value = readErrorMessage(error, "Could not show the scheduled notice.");
      });
    }, HOST_NOTICE_DELAY_MS);
  }

  return {
    hostFocused,
    hostAvailable,
    hostStatus,
    hostSeverity,
    install,
    teardown,
    checkHostFocus,
    requestHostFocusNow,
    requestHostFocusLater,
    startHostProgress,
    scheduleHostNotice,
    cancelHostTimers: clearTimers,
  };
}
