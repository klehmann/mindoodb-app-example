/**
 * The app's texts in every language Haven speaks, without an i18n library.
 *
 * - `locales/en.ts` is the reference. `Messages` is derived from it, and every
 *   other table is checked with `satisfies Messages`, so a key missing in (or added
 *   only to) one language fails `vue-tsc`. `i18n.test.ts` also compares every
 *   language's `{placeholders}` and plural forms with English.
 * - Haven tells the app its UI language: `launchContext.locale` at start and
 *   `session.onLocaleChange` afterwards (see `useMindooDBDemoApp.connect`). Both call
 *   `setLocale()`; `language` is a Vue ref, so every `t()` in a template or
 *   `computed` re-renders when it changes.
 * - `t(key, params)` fills `{name}` placeholders; `tn(key, count)` picks the plural
 *   form `Intl.PluralRules` names for `count` (Polish needs one/few/many).
 * - Dates and numbers go through `Intl` with `intlLocale` (`formatDateTime`).
 * - PrimeVue's own texts need no translation here: the components this app uses
 *   (Button, Tag, Message, ProgressSpinner) show none. An app that uses dialogs,
 *   pickers or tables would set PrimeVue's `locale` from `t()` as well.
 *
 * Messages a composable stores in a ref (a status line, an error) are translated
 * when they are set; they follow a later language change with the next message.
 */
import { ref } from "vue";

import { de } from "./locales/de";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { nb } from "./locales/nb";
import { nl } from "./locales/nl";
import { pl } from "./locales/pl";

export const LOCALES = ["en", "de", "es", "fr", "it", "nb", "nl", "pl"] as const;
export type Locale = (typeof LOCALES)[number];

/** Plural forms by `Intl.PluralRules` category; `other` is required. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

type English = typeof en;
/** Exactly the English keys: a string where English has one, plural forms where English has them. */
export type Messages = { [K in keyof English]: English[K] extends string ? string : PluralForms };
/** Keys of plain strings, for `t()`. */
export type MessageKey = { [K in keyof English]: English[K] extends string ? K : never }[keyof English];
/** Keys of plural messages, for `tn()`. */
export type PluralKey = Exclude<keyof English, MessageKey>;

export const messages = { en, de, es, fr, it, nb, nl, pl } satisfies Record<Locale, Messages>;

/** The language the app shows. */
export const language = ref<Locale>("en");
/** The BCP-47 tag for `Intl` (dates, numbers): Haven's tag when it fits `language`. */
export const intlLocale = ref("en");

/** Haven's tag → a shipped language by its primary subtag (`de-AT` → `de`, `no`/`nn` → `nb`); else English. */
export function resolveLocale(tag: string | undefined): Locale {
  const primary = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (primary === "no" || primary === "nn") return "nb";
  return (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : "en";
}

/** Follows Haven's locale. Call it with `launchContext.locale` and from `session.onLocaleChange`. */
export function setLocale(tag: string | undefined) {
  const next = resolveLocale(tag);
  language.value = next;
  let intlTag: string = next;
  try {
    // Keep the region Haven sends ("de-AT" formats dates the Austrian way).
    const canonical = Intl.getCanonicalLocales((tag ?? "").replace(/_/g, "-"))[0];
    if (canonical && resolveLocale(canonical) === next) intlTag = canonical;
  } catch {
    // Not a valid tag: format with the bare language.
  }
  intlLocale.value = intlTag;
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

type Params = Record<string, string | number>;

function fill(text: string, params: Params): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The text for `key` in the current language, with `{placeholders}` filled from `params`. */
export function t(key: MessageKey, params: Params = {}): string {
  return fill(messages[language.value][key], params);
}

/** A text that depends on a number: picks the plural form for `count` and fills `{count}`. */
export function tn(key: PluralKey, count: number, params: Params = {}): string {
  const forms: PluralForms = messages[language.value][key];
  const category = new Intl.PluralRules(language.value).select(count);
  return fill(forms[category] ?? forms.other, { ...params, count: formatNumber(count) });
}

/**
 * Splits a text at its placeholders so a template can render them as markup
 * (`<code>`, `<strong>`) instead of building HTML strings:
 * `segments("agentCode", { tools: "x.ts" })` → `[{ text: "Code: " }, { text: "x.ts", param: "tools" }, …]`.
 */
export function segments(key: MessageKey, params: Params): Array<{ text: string; param?: string }> {
  return messages[language.value][key]
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name && name in params ? { text: String(params[name]), param: name } : { text: part };
    });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(intlLocale.value).format(value);
}

/** Date and time in the current language; "n/a" for nothing, the raw value when it is no date. */
export function formatDateTime(value: number | string | null | undefined): string {
  if (value == null) return t("notAvailable");
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleString(intlLocale.value, { dateStyle: "medium", timeStyle: "medium" });
}

export function formatTime(value: number | string): string {
  return new Date(value).toLocaleTimeString(intlLocale.value);
}
