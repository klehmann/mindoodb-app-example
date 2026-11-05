import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import {
  createMindooDBAppBridge,
  type MindooDBAppAttachmentInfo,
  type MindooDBAppAttachmentStorage,
  type MindooDBAppDatabase,
} from "mindoodb-app-sdk";
import { createFakeBridgeHost } from "mindoodb-app-sdk/testing";

import { useAttachmentAvailability } from "./useAttachmentAvailability";

const FILES: MindooDBAppAttachmentInfo[] = [
  { attachmentId: "a1", fileName: "plan.pdf", mimeType: "application/pdf", size: 4_000_000 },
  { attachmentId: "a2", fileName: "notes.txt", mimeType: "text/plain", size: 1_000 },
];

let host: ReturnType<typeof createFakeBridgeHost> | null = null;
let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  host?.dispose();
  host = null;
});

async function openDatabase(storage: MindooDBAppAttachmentStorage | undefined) {
  host = createFakeBridgeHost({
    databases: [
      {
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "attachments"],
          ...(storage ? { attachmentStorage: storage } : {}),
        },
        methods: { attachments: { list: async () => FILES } },
      },
    ],
  });
  host.install();
  const session = await createMindooDBAppBridge().connect();
  return await session.openDatabase("main");
}

function mount(database: MindooDBAppDatabase) {
  let api!: ReturnType<typeof useAttachmentAvailability>;
  const db: Ref<MindooDBAppDatabase | null> = ref(database);
  const Probe = defineComponent({
    setup() {
      api = useAttachmentAvailability({
        database: db,
        docId: ref("d1"),
        attachmentIds: ref(FILES.map((file) => file.attachmentId)),
        locale: ref("de"),
      });
      return () => h("div");
    },
  });
  const app = createApp(Probe);
  app.mount(document.createElement("div"));
  unmount = () => app.unmount();
  return api;
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};

describe("useAttachmentAvailability", () => {
  it("marks files only on the server and pins one with progress", async () => {
    const api = mount(await openDatabase("onDemand"));
    await settle();

    expect(api.enabled.value).toBe(true);
    expect(api.displayOf("a1")).toMatchObject({ icon: "cloud", action: { kind: "pin" } });
    expect(api.isNotOnDevice("a1")).toBe(true);
    expect(api.missingBytes.value).toBe(4_001_000);

    await api.togglePin("a1");
    await settle();

    expect(api.availabilityOf("a1")).toMatchObject({ state: "local", pinned: true });
    expect(api.displayOf("a1")).toMatchObject({ icon: "pin", action: { kind: "unpin", label: "Nicht mehr offline halten" } });
    expect(api.isNotOnDevice("a1")).toBe(false);
    expect(api.missingBytes.value).toBe(1_000);

    await api.togglePin("a1");
    await settle();
    expect(api.availabilityOf("a1")).toMatchObject({ state: "remote", pinned: false });
  });

  it("pins and releases the whole document, also single-file pins", async () => {
    const api = mount(await openDatabase("onDemand"));
    await settle();

    await api.togglePin("a2");
    await api.toggleDocumentPin();
    await settle();
    expect(api.documentPinned.value).toBe(true);
    expect(api.missingBytes.value).toBe(0);

    await api.toggleDocumentPin();
    await settle();
    expect(api.documentPinned.value).toBe(false);
    expect(api.availabilityOf("a1")?.pinned).toBe(false);
    expect(api.availabilityOf("a2")?.pinned).toBe(false);
  });

  it("stays inactive for databases that keep attachments locally or on old hosts", async () => {
    const local = mount(await openDatabase("local"));
    await settle();
    expect(local.enabled.value).toBe(false);
    expect(local.displayOf("a1")).toBeNull();
    expect(local.isNotOnDevice("a1")).toBe(false);
    unmount?.();
    host?.dispose();

    const legacy = mount(await openDatabase(undefined));
    await settle();
    expect(legacy.storage.value).toBe("local");
    expect(legacy.displayOf("a1")).toBeNull();
  });

  it("treats a server database as server-backed without offering pins", async () => {
    const api = mount(await openDatabase("remote"));
    await settle();
    expect(api.enabled.value).toBe(false);
    expect(api.serverBacked.value).toBe(true);
    expect(api.isNotOnDevice("a1")).toBe(true);
  });
});
