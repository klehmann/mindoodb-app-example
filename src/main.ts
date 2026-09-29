import { isLaunchedByHaven, renderHavenAppLandingPage } from "mindoodb-app-sdk";
import { createApp } from "vue";
import PrimeVue from "primevue/config";
import "primeicons/primeicons.css";

import App from "./App.vue";
import "@/assets/styles/main.css";
import { applyAppTheme, buildPrimeVueTheme, DEFAULT_THEME_PRESET } from "@/lib/theme";

// Opened from Haven: run the app. Opened directly (a shared link, a bookmark): there is
// no host to talk to, so show what the app is and a button that installs it in Haven.
if (isLaunchedByHaven()) {
  const app = createApp(App);

  app.use(PrimeVue, {
    ripple: true,
    theme: buildPrimeVueTheme(DEFAULT_THEME_PRESET),
  });

  applyAppTheme();
  app.mount("#app");
} else {
  void renderHavenAppLandingPage();
}
