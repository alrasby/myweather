import { createServerFn } from "@tanstack/react-start";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MyWeather/1.0)", Accept: "application/xml, text/plain, */*" };

/** نصوص تحذيرات JTWC الحالية. التحليل يبقى في المتصفح حتى تبقى الدالة نقية. */
export const fetchCycloneTexts = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const rssRes = await fetch("https://www.metoc.navy.mil/jtwc/rss/jtwc.rss", {
      headers: UA,
      signal: AbortSignal.timeout(15000),
    });
    if (!rssRes.ok) return [] as string[];
    const rss = await rssRes.text();
    const urls = [
      ...new Set(
        [...rss.matchAll(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/[a-z]{2}\d{4}web\.txt/gi)].map((m) => m[0]),
      ),
    ];
    const texts = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
          if (!res.ok) return "";
          return await res.text();
        } catch {
          return "";
        }
      }),
    );
    return texts.filter((text) => text.includes("REPEAT POSIT"));
  } catch {
    return [] as string[];
  }
});
