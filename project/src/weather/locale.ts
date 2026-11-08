import type { Lang, LangPref } from "@/weather/types";

/** لغات تُكتب من اليمين. الاتجاه يتبع لغة النص المعروضة حتى لا ينكسر التخطيط. */
const RTL = new Set(["ar", "fa", "ur", "he", "ps", "sd", "ckb", "ku", "dv", "yi", "ug", "arc", "nqo", "rhg", "syr"]);

const ALIAS: Record<string, string> = {
  iw: "he",
  in: "id",
  nb: "no",
  nn: "no",
  ji: "yi",
};

export type Ui = {
  copy: Lang;
  tag: string;
  dir: "rtl" | "ltr";
  base: string;
};

const AR: Ui = { copy: "ar", tag: "ar", dir: "rtl", base: "ar" };
const EN: Ui = { copy: "en", tag: "en", dir: "ltr", base: "en" };

let activeTag = "ar-u-nu-latn";
let activeBase = "ar";

export function deviceLocales(): string[] {
  if (typeof navigator === "undefined") return ["en"];
  const list = navigator.languages?.length ? [...navigator.languages] : [navigator.language || "en"];
  return list.filter((tag) => typeof tag === "string" && tag.length > 0);
}

export function baseOf(tag: string): string {
  const raw = tag.toLowerCase().split("-")[0] ?? "en";
  return ALIAS[raw] ?? raw;
}

export function isRtlBase(base: string): boolean {
  return RTL.has(base);
}

/** قبل معرفة لغة الجهاز نثبّت العربية حتى يتطابق الخادم مع أول رسم. */
export function resolveUi(pref: LangPref, device: Ui | null): Ui {
  if (pref === "ar") return AR;
  if (pref === "en") return EN;
  return device ?? AR;
}

export function deviceUi(hasPack: (base: string) => boolean): Ui {
  const tag = deviceLocales()[0] ?? "en";
  const base = baseOf(tag) || "en";
  if (base === "ar") return { copy: "ar", tag, dir: "rtl", base: "ar" };
  if (base === "en") return { copy: "en", tag, dir: "ltr", base: "en" };
  if (hasPack(base)) {
    return { copy: "en", tag, dir: RTL.has(base) ? "rtl" : "ltr", base };
  }
  /* لغة بلا حزمة: النصوص بالإنجليزية والاتجاه من اليسار حتى لا يختلط سطر إنجليزي مع اتجاه معاكس. */
  return { copy: "en", tag, dir: "ltr", base: "en" };
}

function withLatn(tag: string): string {
  if (tag.includes("nu-latn")) return tag;
  if (tag.includes("-u-")) return `${tag}-nu-latn`;
  return `${tag}-u-nu-latn`;
}

/** أرقام لاتينية دائماً حتى لا يقفز عرض البطاقات بين أنظمة الأرقام. */
export function applyUi(ui: Ui) {
  activeBase = ui.base;
  activeTag = withLatn(ui.tag || (ui.copy === "ar" ? "ar" : "en"));
}

export function localeFor(_lang?: Lang): string {
  return activeTag;
}

export function textBase(): string {
  return activeBase;
}

export function dirFor(lang: Lang): "rtl" | "ltr" {
  if (activeBase === "ar" || lang === "ar") return "rtl";
  return RTL.has(activeBase) ? "rtl" : "ltr";
}
