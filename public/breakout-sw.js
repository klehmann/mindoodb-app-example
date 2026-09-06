/**
 * A hostile service worker, for the Isolation tab to try to install.
 *
 * The interesting question is not what this file does but whether a hosted app
 * is allowed to register it at all. A worker registered from the app document
 * takes the bundle prefix as its scope, and a worker that controls the app sees
 * every request the app makes — including requests the runner's worker would
 * otherwise have checked against the network allowlist.
 *
 * It lives in `public/` so Vite copies it verbatim into `dist/`, which puts it
 * in the bundle at the path `register("./breakout-sw.js")` resolves to.
 *
 * ## Why it deliberately does not take over
 *
 * No `skipWaiting()` and no `clients.claim()`. Both are one line away, and
 * leaving them out is the difference between demonstrating the hole and falling
 * into it: a worker that claims the open page immediately starts answering the
 * bundle's own asset requests, which only the runner's worker can serve, and
 * the running demo breaks in front of whoever pressed the button. The probe
 * unregisters this worker as soon as it has its answer for the same reason.
 */

self.addEventListener("fetch", (event) => {
  // Answering one marked request is enough to show the intent. Everything else
  // falls through untouched, so this worker cannot disturb a page by accident
  // if it ever does end up in control.
  const url = new URL(event.request.url);
  if (url.searchParams.has("mindoodbBreakoutProbe")) {
    event.respondWith(
      new Response("intercepted by the app's own service worker", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }
});
