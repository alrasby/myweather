import { t } from "@/weather/i18n";
import { useWeather } from "@/weather/store";
import type { Lang, MorningAt, Prefs, QuietHours, RefreshMin, ShadeKind } from "@/weather/types";
import { useEffect, useState, type ReactNode } from "react";

export function SettingsScreen({ lang }: { lang: Lang }) {
  const prefs = useWeather((s) => s.prefs);
  const setPrefs = useWeather((s) => s.setPrefs);
  const clearCache = useWeather((s) => s.clearCache);
  const notice = useWeather((s) => s.notice);
  const setNotice = useWeather((s) => s.setNotice);
  const [widgetReady, setWidgetReady] = useState(false);
  useEffect(() => {
    const bridge = (window as unknown as { AndroidWidget?: { openSettings?: () => void } }).AndroidWidget;
    setWidgetReady(!!bridge?.openSettings);
  }, []);

  return (
    <div className="wx-settings h-full overflow-y-auto px-3.5 pb-[calc(3.6rem+max(0.85rem,env(safe-area-inset-bottom))+10px)] pt-3">
      <Card title={t(lang, "appearance")}>
        <Field label={t(lang, "language")}>
          <Chips
            value={prefs.lang}
            options={[
              ["system", t(lang, "system")],
              ["ar", t(lang, "arabic")],
              ["en", t(lang, "english")],
            ]}
            onChange={(langPref) => setPrefs({ lang: langPref })}
          />
        </Field>
        <Field label={t(lang, "theme")}>
          <Chips
            cols={2}
            value={prefs.theme}
            options={[
              ["sun", t(lang, "themeSun")],
              ["system", t(lang, "system")],
              ["light", t(lang, "light")],
              ["dark", t(lang, "dark")],
            ]}
            onChange={(theme) => setPrefs({ theme })}
          />
        </Field>
      </Card>

      <Card title={t(lang, "units")}>
        <Field label={t(lang, "temperature")}>
          <Chips
            value={prefs.temp}
            options={[
              ["c", t(lang, "celsius")],
              ["f", t(lang, "fahrenheit")],
            ]}
            onChange={(temp) => setPrefs({ temp })}
          />
        </Field>
        <Field label={t(lang, "wind")}>
          <Chips
            value={prefs.wind}
            options={[
              ["kmh", t(lang, "kmh")],
              ["ms", t(lang, "ms")],
              ["mph", t(lang, "mph")],
              ["kn", t(lang, "kn")],
            ]}
            onChange={(wind) => setPrefs({ wind })}
          />
        </Field>
        <Field label={t(lang, "pressure")}>
          <Chips
            value={prefs.pressure}
            options={[
              ["hpa", t(lang, "hpa")],
              ["inhg", t(lang, "inhg")],
            ]}
            onChange={(pressure) => setPrefs({ pressure })}
          />
        </Field>
      </Card>

      <Card title={t(lang, "refreshAlerts")}>
        <Field label={t(lang, "autoRefresh")}>
          <Chips
            cols={3}
            value={String(prefs.refreshMin)}
            options={[
              ["0", t(lang, "manual")],
              ["15", t(lang, "every15")],
              ["30", t(lang, "every30")],
              ["60", t(lang, "everyHour")],
              ["180", t(lang, "every3")],
              ["360", t(lang, "every6")],
            ]}
            onChange={(id) => setPrefs({ refreshMin: Number(id) as RefreshMin })}
          />
        </Field>
        <Toggle on={prefs.alerts} title={t(lang, "alerts")} hint={t(lang, "alertsHint")} onClick={() => setPrefs({ alerts: !prefs.alerts })} />
        {widgetReady ? (
          <button
            type="button"
            className="wx-settings-action rounded-2xl border border-line px-3 py-3 text-start"
            onClick={() => {
              const bridge = (window as unknown as { AndroidWidget?: { openSettings?: () => void } }).AndroidWidget;
              bridge?.openSettings?.();
            }}
          >
            <span className="block text-sm font-semibold text-fg">{t(lang, "widgetHome")}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">{t(lang, "widgetHomeHint")}</span>
          </button>
        ) : null}
        <Toggle
          on={prefs.wifiOnly}
          disabled={prefs.refreshMin === 0}
          title={t(lang, "wifiOnly")}
          hint={prefs.refreshMin === 0 ? t(lang, "wifiNeedsRefresh") : undefined}
          onClick={() => setPrefs({ wifiOnly: !prefs.wifiOnly })}
        />
        <Toggle on={prefs.dataSaver} title={t(lang, "dataSaver")} hint={t(lang, "dataSaverHint")} onClick={() => setPrefs({ dataSaver: !prefs.dataSaver })} />
        <div className={prefs.alerts ? "" : "pointer-events-none opacity-45"}>
        <Field label={t(lang, "rainFrom")}>
          <Chips
            value={String(prefs.rainAlert)}
            options={[
              ["0.2", "0.2 mm"],
              ["1", "1 mm"],
              ["2", "2 mm"],
            ]}
            onChange={(id) => setPrefs({ rainAlert: Number(id) as Prefs["rainAlert"] })}
          />
        </Field>
        <Field label={t(lang, "windFrom")}>
          <Chips
            value={String(prefs.windAlert)}
            options={[
              ["30", `30 ${t(lang, "kmh")}`],
              ["45", `45 ${t(lang, "kmh")}`],
              ["60", `60 ${t(lang, "kmh")}`],
            ]}
            onChange={(id) => setPrefs({ windAlert: Number(id) as Prefs["windAlert"] })}
          />
        </Field>
        <Field label={t(lang, "dustFrom")}>
          <Chips
            value={String(prefs.dustAlert)}
            options={[
              ["80", "80"],
              ["150", "150"],
              ["250", "250"],
            ]}
            onChange={(id) => setPrefs({ dustAlert: Number(id) as Prefs["dustAlert"] })}
          />
        </Field>
        </div>
        <Field label={t(lang, "morningSum")}>
          <Chips
            value={prefs.morning}
            options={[
              ["5:30", "5:30"],
              ["6:00", "6:00"],
              ["6:30", "6:30"],
              ["7:30", "7:30"],
            ]}
            onChange={(morning) => setPrefs({ morning: morning as MorningAt })}
          />
        </Field>
        <Field label={t(lang, "quietHours")}>
          <Chips
            value={prefs.quiet}
            options={[
              ["off", t(lang, "off")],
              ["22-6", "22–6"],
              ["23-7", "23–7"],
            ]}
            onChange={(quiet) => setPrefs({ quiet: quiet as QuietHours })}
          />
        </Field>
      </Card>

      <Card title={t(lang, "map")}>
        <Field label={t(lang, "defaultLayer")}>
          <Chips
            value={String(prefs.mapLayer)}
            options={[
              ["1", t(lang, "tempLayer")],
              ["0", t(lang, "windLayer")],
              ["2", t(lang, "rainLayer")],
            ]}
            onChange={(id) => setPrefs({ mapLayer: Number(id) as ShadeKind })}
          />
        </Field>
        <Field label={t(lang, "timeSpan")}>
          <Chips
            value={String(prefs.mapHours === 72 ? 48 : prefs.mapHours)}
            options={[
              ["24", t(lang, "span24")],
              ["48", t(lang, "span48")],
            ]}
            onChange={(id) => setPrefs({ mapHours: Number(id) as Prefs["mapHours"] })}
          />
        </Field>
        <Field label={t(lang, "windMotion")}>
          <Chips
            value={prefs.particles === "high" ? "high" : "low"}
            disabled={prefs.dataSaver}
            options={[
              ["low", t(lang, "motionLight")],
              ["high", t(lang, "motionClear")],
            ]}
            onChange={(particles) => setPrefs({ particles })}
          />
        </Field>
        <Toggle on={prefs.storms} title={t(lang, "storms")} hint={t(lang, "stormsHint")} onClick={() => setPrefs({ storms: !prefs.storms })} />
      </Card>

      <section className="wx-card wx-settings-card mb-3 px-4 py-4">
        <h2 className="text-[0.95rem] font-semibold text-fg">{t(lang, "sources")}</h2>
        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-muted">{t(lang, "sourcesBody")}</p>
        <button
          type="button"
          className="cache-btn mt-3 h-11 w-full rounded-full text-xs font-semibold text-fg"
          onClick={() => {
            clearCache();
            window.setTimeout(() => setNotice(null), 1600);
          }}
        >
          {notice === "cleared" ? t(lang, "cleared") : t(lang, "clearCache")}
        </button>
      </section>
      <div className="flex justify-center pb-1 pt-1">
        <p dir="ltr" className="credit credit-glass inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.68rem] font-medium">
          Made with <span className="text-danger">♥</span> By NabdhServ.Net
        </p>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wx-card wx-settings-card mb-3 px-4 py-4">
      <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight text-fg"><span aria-hidden="true" className="wx-settings-dot" />{title}</h2>
      <div className="mt-3.5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[0.75rem] font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  cols,
  disabled,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  cols?: number;
  disabled?: boolean;
}) {
  const columns = cols ?? options.length;
  const grid = Boolean(cols && options.length > cols);
  return (
    <div
      className={`chip-track wx-settings-chips gap-1 p-1 ${grid ? "chip-grid grid" : "grid"} ${disabled ? "opacity-45" : ""}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map(([id, label]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex min-h-11 w-full items-center justify-center rounded-full px-2 py-1.5 text-center text-[0.78rem] leading-tight ${on ? "chip-on font-semibold" : "text-fg/85"}`}
            aria-pressed={on}
            disabled={disabled}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, title, hint, onClick, disabled }: { on: boolean; title: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-t border-line pt-3.5 ${disabled ? "opacity-45" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] font-semibold leading-snug text-fg">{title}</p>
        {hint ? <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 ${on ? "bg-chip" : "bg-line"}`}
      >
        <span className={`size-6 rounded-full bg-on-sky shadow-sm transition-transform ${on ? "translate-x-6 rtl:-translate-x-6" : ""}`} />
      </button>
    </div>
  );
}
