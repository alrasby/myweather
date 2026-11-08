import { textBase } from "@/weather/locale";
import type { Lang } from "@/weather/types";

const WORDS: Record<string, readonly string[]> = {
  ar: ["شمال", "شمال شرق", "شرق", "جنوب شرق", "جنوب", "جنوب غرب", "غرب", "شمال غرب"],
  en: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
  fr: ["N", "NE", "E", "SE", "S", "SO", "O", "NO"],
  es: ["N", "NE", "E", "SE", "S", "SO", "O", "NO"],
  de: ["N", "NO", "O", "SO", "S", "SW", "W", "NW"],
  tr: ["K", "KD", "D", "GD", "G", "GB", "B", "KB"],
  fa: ["شمال", "شمال شرق", "شرق", "جنوب شرق", "جنوب", "جنوب غرب", "غرب", "شمال غرب"],
  ur: ["شمال", "شمال مشرق", "مشرق", "جنوب مشرق", "جنوب", "جنوب مغرب", "مغرب", "شمال مغرب"],
  he: ["צ", "צמ", "מ", "דמ", "ד", "דמע", "מע", "צמע"],
  ru: ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"],
  uk: ["Пн", "ПнС", "С", "ПдС", "Пд", "ПдЗ", "З", "ПнЗ"],
  zh: ["北", "东北", "东", "东南", "南", "西南", "西", "西北"],
  ja: ["北", "北東", "東", "南東", "南", "南西", "西", "北西"],
  ko: ["북", "북동", "동", "남동", "남", "남서", "서", "북서"],
  hi: ["उ", "उपू", "पू", "दपू", "द", "दप", "प", "उप"],
  bn: ["উ", "উপূ", "পূ", "দপূ", "দ", "দপ", "প", "উপ"],
};

/** اتجاه أرصادي: من أين تأتي الرياح (0 = شمال). */
export function compassFrom(dirFrom: number, lang: Lang): string {
  if (!Number.isFinite(dirFrom)) return "—";
  const deg = ((dirFrom % 360) + 360) % 360;
  const i = Math.round(deg / 45) % 8;
  const list = WORDS[textBase()] ?? (lang === "ar" ? WORDS.ar : WORDS.en);
  return list?.[i] ?? "—";
}

/** اتجاه حركة الجزيئات (إلى أين تهب) — 0 = شمال على الشاشة. */
export function flowToward(dirFrom: number): number {
  if (!Number.isFinite(dirFrom)) return 0;
  return (((dirFrom + 180) % 360) + 360) % 360;
}

/** من مركّبَي u شرق / v شمال (كم/س) إلى اتجاه «قادمة من». */
export function dirFromUV(u: number, v: number): { from: number; to: number } {
  const to = (Math.atan2(u, v) * 180) / Math.PI;
  const toN = ((to % 360) + 360) % 360;
  const from = (toN + 180) % 360;
  return { from, to: toN };
}
