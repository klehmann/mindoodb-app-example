/**
 * Every language ships every text. The type check already rejects a missing or extra
 * key (`satisfies Messages`); this test covers what types cannot see: the
 * `{placeholders}`, the plural forms each language needs, empty strings and French
 * typography.
 */
import { afterEach, describe, expect, it } from "vitest";

import { language, LOCALES, messages, resolveLocale, segments, setLocale, t, tn, type PluralForms } from "@/i18n";

import havenApp from "../../public/haven-app.json";

type Entry = string | PluralForms;
const table = messages as unknown as Record<string, Record<string, Entry>>;
const english = table.en!;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

function texts(entry: Entry): string[] {
  return typeof entry === "string" ? [entry] : Object.values(entry);
}

afterEach(() => setLocale("en"));

describe("i18n tables", () => {
  it.each(LOCALES)("%s has exactly the English keys", (locale) => {
    expect(Object.keys(table[locale]!).sort()).toEqual(Object.keys(english).sort());
  });

  it.each(LOCALES)("%s keeps the English placeholders and string/plural shape", (locale) => {
    for (const [key, source] of Object.entries(english)) {
      const entry = table[locale]![key]!;
      expect(typeof entry, key).toBe(typeof source);
      if (typeof source === "string") {
        expect(placeholders(entry as string), `${locale}.${key}`).toEqual(placeholders(source));
      } else {
        const forms = entry as PluralForms;
        // The general form carries every placeholder; "one" may leave out the number.
        expect(placeholders(forms.other), `${locale}.${key}.other`).toEqual(placeholders(source.other));
        for (const [category, text] of Object.entries(forms)) {
          for (const name of placeholders(text!)) {
            expect(placeholders(source.other), `${locale}.${key}.${category}`).toContain(name);
          }
        }
      }
    }
  });

  it.each(LOCALES)("%s has a plural form for every count its plural rules pick", (locale) => {
    const rules = new Intl.PluralRules(locale);
    for (const [key, entry] of Object.entries(table[locale]!)) {
      if (typeof entry === "string") continue;
      for (const count of [0, 1, 2, 3, 5, 11, 12, 21, 22, 25, 101, 1_000_000]) {
        const category = rules.select(count);
        expect(entry[category], `${locale}.${key} for ${count} (${category})`).toBeTypeOf("string");
      }
    }
  });

  it.each(LOCALES)("%s has no empty texts", (locale) => {
    for (const [key, entry] of Object.entries(table[locale]!)) {
      for (const text of texts(entry)) expect(text.trim(), `${locale}.${key}`).not.toBe("");
    }
  });

  it("French puts a non-breaking space before : ; ? ! and inside « »", () => {
    // Code tokens keep their colon: about:blank, pnpm dev:local, https://…
    const code = /about:blank|dev:local|\w+:\/\//g;
    for (const [key, entry] of Object.entries(table.fr!)) {
      for (const raw of texts(entry)) {
        const text = raw.replace(code, "");
        expect(text, `fr.${key}`).not.toMatch(/ [:;?!»]|« /);
        expect(text, `fr.${key}`).not.toMatch(/[^\s  ][;?!»:]/);
        expect(text, `fr.${key}`).not.toMatch(/«[^\s  ]/);
      }
    }
  });
});

describe("locale selection", () => {
  it.each([
    ["en-US", "en"],
    ["de-AT", "de"],
    ["fr-CA", "fr"],
    ["es-MX", "es"],
    ["it", "it"],
    ["nb-NO", "nb"],
    ["no", "nb"],
    ["nn-NO", "nb"],
    ["nl-BE", "nl"],
    ["PL", "pl"],
    ["ja-JP", "en"],
    ["", "en"],
    [undefined, "en"],
  ])("%s → %s", (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected);
  });

  it("switches texts with Haven's locale", () => {
    setLocale("de-AT");
    expect(language.value).toBe("de");
    expect(t("save")).not.toBe(english.save);
    setLocale("ja");
    expect(t("save")).toBe("Save");
  });

  it("fills placeholders and picks plural forms", () => {
    expect(t("createdDocument", { id: "d1" })).toBe("Created document d1.");
    expect(tn("uploadedAttachments", 1)).toBe("Uploaded 1 attachment.");
    expect(tn("uploadedAttachments", 3)).toBe("Uploaded 3 attachments.");
    setLocale("pl");
    const forms = messages.pl.attachmentCount;
    expect(tn("attachmentCount", 1)).toBe(forms.one.replace("{count}", "1"));
    expect(tn("attachmentCount", 3)).toBe(forms.few.replace("{count}", "3"));
    expect(tn("attachmentCount", 5)).toBe(forms.many.replace("{count}", "5"));
  });

  it("splits a text at its placeholders for markup", () => {
    expect(segments("storedIn", { database: "sdkexample" })).toEqual([
      { text: "Stored in " },
      { text: "sdkexample", param: "database" },
    ]);
  });
});

describe("haven-app.json", () => {
  /** The texts below every "fr" key: the localized store listing Haven shows. */
  function french(value: unknown, path = "", out: [string, string][] = []): [string, string][] {
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "fr" && typeof child === "string") out.push([`${path}.fr`, child]);
        else french(child, `${path}.${key}`, out);
      }
    }
    return out;
  }

  it("French puts a non-breaking space before : ; ? ! and inside « »", () => {
    const bad = french(havenApp)
      .filter(([, text]) => / [:;?!»]|« /.test(text))
      .map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
