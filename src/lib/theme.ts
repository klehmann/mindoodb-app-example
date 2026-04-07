import { Theme, definePreset } from "@primeuix/styled";
import Aura from "@primeuix/themes/aura";
import Lara from "@primeuix/themes/lara";
import Material from "@primeuix/themes/material";
import Nora from "@primeuix/themes/nora";

import type { MindooDBAppHostTheme, MindooDBAppThemeMode } from "mindoodb-app-sdk";

const MINDOO_PRIMARY_SCALE = {
  50: "#eef2ff",
  100: "#dce5ff",
  200: "#bfceff",
  300: "#98adff",
  400: "#6f88f6",
  500: "#4d67d9",
  600: "#354fb9",
  700: "#253c92",
  800: "#1f3a8a",
  900: "#182a63",
  950: "#0b1020",
} as const;

const MINDOO_GOLD_SCALE = {
  50: "#fff8e8",
  100: "#fbeec6",
  200: "#f6df91",
  300: "#efcb58",
  400: "#e2b33f",
  500: "#d4a017",
  600: "#b88812",
  700: "#91690f",
  800: "#6c4f0f",
  900: "#503c10",
  950: "#2d2109",
} as const;

const MINDOO_THEME_PRESET = definePreset(Aura, {
  semantic: {
    primary: MINDOO_PRIMARY_SCALE,
    colorScheme: {
      light: {
        primary: {
          color: "#1f3a8a",
          contrastColor: "#ffffff",
          hoverColor: "#243c8f",
          activeColor: "#182a63",
        },
        highlight: {
          background: "rgba(31, 58, 138, 0.12)",
          focusBackground: "rgba(31, 58, 138, 0.18)",
          color: "#17233b",
          focusColor: "#0b1020",
        },
      },
      dark: {
        primary: {
          color: "#1f3a8a",
          contrastColor: "#ffffff",
          hoverColor: "#243c8f",
          activeColor: "#182a63",
        },
        highlight: {
          background: "rgba(31, 58, 138, 0.2)",
          focusBackground: "rgba(31, 58, 138, 0.28)",
          color: "#f4f7fb",
          focusColor: "#ffffff",
        },
      },
    },
    focusRing: {
      width: "2px",
      style: "solid",
      color: "rgba(212, 160, 23, 0.38)",
      offset: "2px",
      shadow: "none",
    },
  },
  extend: {
    brand: {
      gold: MINDOO_GOLD_SCALE,
    },
  },
});

const THEME_PRESET_REGISTRY = {
  mindoo: {
    label: "Mindoo",
    preset: MINDOO_THEME_PRESET,
  },
  aura: {
    label: "Aura",
    preset: Aura,
  },
  lara: {
    label: "Lara",
    preset: Lara,
  },
  material: {
    label: "Material",
    preset: Material,
  },
  nora: {
    label: "Nora",
    preset: Nora,
  },
} as const;

export type ThemePresetKey = keyof typeof THEME_PRESET_REGISTRY;

export type AppThemeState = {
  mode: MindooDBAppThemeMode;
  preset: ThemePresetKey;
};

export const DEFAULT_THEME_PRESET: ThemePresetKey = "mindoo";
export const DEFAULT_THEME_MODE: MindooDBAppThemeMode = "dark";
export const DEFAULT_THEME: AppThemeState = {
  mode: DEFAULT_THEME_MODE,
  preset: DEFAULT_THEME_PRESET,
};

export function resolveThemePreset(value: unknown): ThemePresetKey {
  if (typeof value === "string" && value in THEME_PRESET_REGISTRY) {
    return value as ThemePresetKey;
  }

  return DEFAULT_THEME_PRESET;
}

export function buildPrimeVueTheme(themePreset: ThemePresetKey) {
  return {
    preset: THEME_PRESET_REGISTRY[themePreset].preset,
    options: {
      darkModeSelector: "[data-theme='dark']",
    },
  };
}

export function normalizeAppTheme(theme?: Partial<MindooDBAppHostTheme> | null): AppThemeState {
  return {
    mode: theme?.mode === "light" ? "light" : "dark",
    preset: resolveThemePreset(theme?.preset),
  };
}

export function applyAppTheme(theme?: Partial<MindooDBAppHostTheme> | null): AppThemeState {
  const resolved = normalizeAppTheme(theme);

  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved.mode;
    document.documentElement.dataset.themePreset = resolved.preset;
  }

  Theme.setTheme(buildPrimeVueTheme(resolved.preset));
  return resolved;
}
