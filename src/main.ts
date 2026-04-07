import { createApp } from "vue";
import PrimeVue from "primevue/config";
import "primeicons/primeicons.css";

import App from "./App.vue";
import "@/assets/styles/main.css";
import { applyAppTheme, buildPrimeVueTheme, DEFAULT_THEME_PRESET } from "@/lib/theme";

const app = createApp(App);

app.use(PrimeVue, {
  ripple: true,
  theme: buildPrimeVueTheme(DEFAULT_THEME_PRESET),
});

applyAppTheme();
app.mount("#app");
