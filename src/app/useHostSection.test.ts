import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOST_FOCUS_DELAY_MS,
  HOST_NOTICE_DELAY_MS,
  HOST_PROGRESS_NOTICE_ID,
  HOST_PROGRESS_STEP_MS,
  HOST_SCHEDULED_NOTICE_ID,
  asDemoHostSession,
  progressPercents,
  useHostSection,
  type DemoHostSession,
} from "@/app/useHostSection";
import type { MindooDBAppSession } from "mindoodb-app-sdk";

function createFakeHostSession() {
  const notices: Array<{ id?: string; text: string; severity: string }> = [];
  let focused = false;
  let focusRequests = 0;
  const listeners = new Set<(focused: boolean) => void>();
  const session: DemoHostSession = {
    async requestHostFocus() {
      focusRequests += 1;
      focused = true;
      listeners.forEach((listener) => listener(true));
    },
    async hasHostFocus() {
      return focused;
    },
    onHostFocusChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async notify(input) {
      notices.push(input);
      return { id: input.id ?? "generated" };
    },
  };
  return { session, notices, get focusRequests() { return focusRequests; } };
}

describe("host tab helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts from 0 to 100 in steps of 10", () => {
    expect(progressPercents()).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("rejects a session that has no host methods", () => {
    expect(asDemoHostSession({})).toBeNull();
  });

  it("updates one progress notice and sends a delayed notice", async () => {
    vi.useFakeTimers();
    const fake = createFakeHostSession();
    const host = useHostSection(ref(fake.session as unknown as MindooDBAppSession));
    await host.install(fake.session as unknown as MindooDBAppSession);
    expect(host.hostAvailable.value).toBe(true);
    expect(host.hostFocused.value).toBe(false);

    host.requestHostFocusLater();
    await vi.advanceTimersByTimeAsync(HOST_FOCUS_DELAY_MS);
    expect(fake.focusRequests).toBe(1);
    expect(host.hostFocused.value).toBe(true);

    host.startHostProgress();
    await vi.advanceTimersByTimeAsync(HOST_PROGRESS_STEP_MS * 10);
    expect(fake.notices.filter((notice) => notice.id === HOST_PROGRESS_NOTICE_ID).map((notice) => notice.text)).toEqual([
      "0%",
      "10%",
      "20%",
      "30%",
      "40%",
      "50%",
      "60%",
      "70%",
      "80%",
      "90%",
      "100%",
    ]);

    const before = fake.notices.length;
    host.scheduleHostNotice();
    await vi.advanceTimersByTimeAsync(HOST_NOTICE_DELAY_MS);
    expect(fake.notices.at(-1)).toMatchObject({
      id: HOST_SCHEDULED_NOTICE_ID,
      text: "Click this notice to show the example app.",
    });
    expect(fake.notices.length).toBe(before + 1);

    host.teardown();
  });
});
