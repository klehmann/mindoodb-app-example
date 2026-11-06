/**
 * The app's test URL, `/__haven-test/`: the real app in an iframe, launched by a mock
 * Haven with the databases, permissions and launch parameters from `haven-app.json`,
 * plus a control panel (theme, host focus, notifications, bridge requests). Use it for
 * Playwright, for AI agents driving the UI, and for clicking through the app without
 * installing it in a real Haven. `window.__havenTestHost` scripts the host.
 *
 * It is served by `pnpm dev` and only built with `HAVEN_TEST_HOST=1` (preview
 * deployments), never for the production deploy: the public URL shows the landing page.
 *
 * `?attachments=onDemand` (or `remote`) reports that attachment storage, so
 * attachment lists mark files only on the server and offer pins;
 * `window.__havenTestOffline = true` then fails every attachment read, as
 * Haven does for on-demand files without a connection.
 */
import type { MindooDBAppDefinition, MindooDBAppAttachmentStorage } from "mindoodb-app-sdk";
import { mockDatabasesFromDefinition, mountHavenTestHost } from "mindoodb-app-sdk/testing";

import { seedComponents, seedDocuments } from "@/testHost/seed";

declare global {
  interface Window {
    /** Test host only: every attachment read fails, like on-demand files offline. */
    __havenTestOffline?: boolean;
  }
}

/** `?attachments=` storage and the offline switch on the mock databases. */
function withAttachmentStorage<T extends { info: object; methods?: { attachments?: object } }>(
  databases: T[],
  storage: MindooDBAppAttachmentStorage | null,
): T[] {
  if (!storage) return databases;
  return databases.map((database) => {
    const attachments = database.methods?.attachments as
      | { openReadStream?: (...args: unknown[]) => Promise<unknown> }
      | undefined;
    const openReadStream = attachments?.openReadStream;
    return {
      ...database,
      info: { ...database.info, attachmentStorage: storage },
      methods: {
        ...database.methods,
        attachments: {
          ...attachments,
          ...(openReadStream
            ? {
                async openReadStream(...args: unknown[]) {
                  if (window.__havenTestOffline) {
                    throw new Error("The server is not reachable.");
                  }
                  return await openReadStream.apply(attachments, args);
                },
              }
            : {}),
        },
      },
    };
  });
}

async function start() {
  const response = await fetch(new URL("../haven-app.json", window.location.href));
  const definition = (await response.json()) as MindooDBAppDefinition;

  mountHavenTestHost({
    appUrl: "../",
    title: definition.label,
    launchContext: {
      appId: definition.appId,
      appVersion: definition.version,
      launchParameters: { ...definition.launchParameters },
      preferredDatabaseId: definition.defaultLaunchDatabaseId,
    },
    databases: withAttachmentStorage(
      mockDatabasesFromDefinition(definition, seedDocuments),
      attachmentStorageParam(),
    ),
    // Agents see the tools under this prefix, as in Haven (`example_documents_list`).
    agentToolPrefix: definition.agentToolPrefix,
    // TeamEdit, TeamGrid and TeamSlides as if installed, for the "Embedded editors" tab.
    components: seedComponents,
  });
}

void start();

/** `?attachments=` of the test page, for {@link withAttachmentStorage}. */
function attachmentStorageParam(): MindooDBAppAttachmentStorage | null {
  const value = new URLSearchParams(window.location.search).get("attachments");
  return value === "onDemand" || value === "remote" || value === "local" ? value : null;
}
