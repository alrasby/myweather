package net.nabdhserv.myweather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.res.Configuration;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

public class WeatherWidget extends AppWidgetProvider {
    static final String PREFS = "myweather_widget";
    static final String KEY_JSON = "payload";
    static final String KEY_ALPHA = "alpha";
    static final String KEY_TINT = "tint";
    static final String KEY_TEXT_TINT = "text_tint";
    static final String KEY_TONE = "tone";
    static final String KEY_STRENGTH = "strength";
    static final String KEY_DARK = "dark";
    static final String KEY_CLOCK = "clock";
    static final String KEY_PLACE = "place";

    private static final int[] ROWS = { R.id.row0, R.id.row1, R.id.row2, R.id.row3 };
    private static final int[] NAMES = { R.id.n0, R.id.n1, R.id.n2, R.id.n3 };
    private static final int[] ICONS = { R.id.i0, R.id.i1, R.id.i2, R.id.i3 };
    private static final int[] TEMPS = { R.id.t0, R.id.t1, R.id.t2, R.id.t3 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        // Refresh Material You color when One UI/Android changes wallpaper or
        // system appearance, without sampling private wallpaper pixels.
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_WALLPAPER_CHANGED.equals(action) ||
            Intent.ACTION_CONFIGURATION_CHANGED.equals(action)) {
            SharedPreferences saved = prefs(context);
            if ("adaptive".equals(saved.getString(KEY_TEXT_TINT, "adaptive")) ||
                "adaptive".equals(saved.getString(KEY_TINT, "ocean"))) {
                updateAll(context);
            }
        }
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, WeatherWidget.class));
        for (int id : ids) render(context, manager, id);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void render(Context context, AppWidgetManager manager, int id) {
        Bundle opts = manager.getAppWidgetOptions(id);
        int w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        boolean wide = w >= 230;
        boolean tall = h >= 90;
        SharedPreferences sp = prefs(context);
        boolean clock = sp.getBoolean(KEY_CLOCK, false);
        String savedTint = sp.getString(KEY_TINT, "ocean");
        // Previous releases used "adaptive" for the glass. Preserve that setting
        // without coupling text contrast to background color from now on.
        String tint = "adaptive".equals(savedTint) ? "ocean" : savedTint;
        String textTint = sp.getString(KEY_TEXT_TINT, "adaptive");
        boolean dark = isDarkGlass(context, tint, sp.getBoolean(KEY_DARK, false));
        int alpha = sp.getInt(KEY_ALPHA, 60);
        int tone = sp.getInt(KEY_TONE, 50);
        int strength = sp.getInt(KEY_STRENGTH, 75);
        int layout;
        boolean forecast = false;
        boolean details = false;
        boolean timed = false;
        if (!wide && !tall) {
            layout = R.layout.widget_2x1;
        } else if (wide && !tall) {
            layout = clock ? R.layout.widget_4x1_clock : R.layout.widget_4x1;
            details = !clock;
            timed = clock;
        } else if (!wide) {
            layout = clock ? R.layout.widget_2x2_clock : R.layout.widget_2x2;
            details = !clock;
            timed = clock;
        } else {
            layout = clock ? R.layout.widget_4x2_clock : R.layout.widget_4x2;
            details = true;
            forecast = !clock;
            timed = clock;
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        JSONObject root = readPayload(sp);
        JSONObject data = pickCity(root, sp.getString(KEY_PLACE, ""));
        boolean rtl = root.optBoolean("rtl", true);
        views.setInt(R.id.root, "setLayoutDirection", rtl ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
        int[] ink = textColors(context, textTint, dark, tint, tone, strength);
        int fg = ink[0];
        int muted = ink[1];
        views.setTextViewText(R.id.city, data.optString("city", "طقسي"));
        views.setTextColor(R.id.city, muted);
        views.setTextViewText(R.id.temp, data.optString("temp", "--°"));
        views.setTextColor(R.id.temp, fg);
        float density = densityOf(context);
        int iconDp = iconDp(h, wide, tall);
        bindGlyph(views, data.optString("icon", "cloud"), density, iconDp);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setViewLayoutWidth(R.id.flip, iconDp, TypedValue.COMPLEX_UNIT_DIP);
            views.setViewLayoutHeight(R.id.flip, iconDp, TypedValue.COMPLEX_UNIT_DIP);
        }
        if (details) {
            views.setTextViewText(R.id.condition, data.optString("condition", ""));
            views.setTextColor(R.id.condition, muted);
            views.setTextViewText(R.id.hilo, data.optString("hilo", ""));
            views.setTextColor(R.id.hilo, fg);
        }
        if (timed) {
            views.setTextColor(R.id.clock, fg);
            views.setTextColor(R.id.date, muted);
        }
        if (forecast) bindDays(views, data, fg, density);
        int wPx = Math.max(1, Math.round(Math.max(w, 110) * density));
        int hPx = Math.max(1, Math.round(Math.max(h, 40) * density));
        // Keep native RemoteViews binder payloads bounded on large tablet widgets.
        final long maxPixels = 220_000L;
        if ((long) wPx * hPx > maxPixels) {
            double factor = Math.sqrt((double) maxPixels / ((long) wPx * hPx));
            wPx = Math.max(1, (int) Math.floor(wPx * factor));
            hPx = Math.max(1, (int) Math.floor(hPx * factor));
        }
        views.setImageViewBitmap(R.id.bg, glass(wPx, hPx, alpha, dark, density, tint, tone, strength, context));
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            context,
            id + 17,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.root, pi);
        manager.updateAppWidget(id, views);
    }

    private static float densityOf(Context context) {
        return context.getResources().getDisplayMetrics().density;
    }

    private static int iconDp(int h, boolean wide, boolean tall) {
        int dp = !tall ? Math.round(h * 0.78f) : !wide ? Math.round(h * 0.46f) : Math.round(h * 0.36f);
        int floor = !tall ? 48 : wide ? 60 : 64;
        int cap = !tall ? 68 : wide ? 92 : 100;
        return Math.max(floor, Math.min(cap, dp));
    }

    private static void bindGlyph(RemoteViews views, String name, float density, int dp) {
        int px = Math.max(96, Math.round(dp * density));
        // Exactly one bitmap is shown: do not allocate three discarded frames.
        // WeatherGlyphs uses condition-specific colors, never the text color.
        views.setImageViewBitmap(R.id.icon_a, WeatherGlyphs.frame(name, px, false, 0));
    }

    private static void bindDays(RemoteViews views, JSONObject data, int fg, float density) {
        JSONArray days = data.optJSONArray("days");
        int mark = Math.max(24, Math.round(18f * density));
        for (int i = 0; i < 4; i++) {
            if (days == null || i >= days.length()) {
                views.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            JSONObject day = days.optJSONObject(i);
            if (day == null) {
                views.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            views.setViewVisibility(ROWS[i], View.VISIBLE);
            views.setTextViewText(NAMES[i], day.optString("name", ""));
            views.setTextColor(NAMES[i], fg);
            views.setTextViewText(TEMPS[i], day.optString("temp", ""));
            views.setTextColor(TEMPS[i], fg);
            views.setImageViewBitmap(ICONS[i], WeatherGlyphs.frame(day.optString("icon", "cloud"), mark, false, 0));
        }
    }

    static JSONObject readPayload(SharedPreferences sp) {
        try {
            String raw = sp.getString(KEY_JSON, "");
            if (raw != null && raw.length() > 2) return new JSONObject(raw);
        } catch (Exception ignored) {
            /* حمولة تالفة */
        }
        return new JSONObject();
    }

    static JSONObject pickCity(JSONObject root, String want) {
        if ("@here".equals(want)) {
            JSONObject here = root.optJSONObject("here");
            if (here != null && here.optString("city", "").length() > 0) return here;
        }
        if (want == null || want.isEmpty() || "@here".equals(want)) return root;
        JSONArray cities = root.optJSONArray("cities");
        if (cities == null) return root;
        for (int i = 0; i < cities.length(); i++) {
            JSONObject city = cities.optJSONObject(i);
            if (city != null && want.equals(city.optString("id")) && city.has("temp")) return city;
        }
        return root;
    }

    static int iconOf(String name) {
        if ("sun".equals(name)) return R.drawable.ic_w_sun;
        if ("moon".equals(name)) return R.drawable.ic_w_moon;
        if ("partly".equals(name)) return R.drawable.ic_w_partly;
        if ("rain".equals(name)) return R.drawable.ic_w_rain;
        if ("snow".equals(name)) return R.drawable.ic_w_snow;
        if ("storm".equals(name)) return R.drawable.ic_w_storm;
        if ("fog".equals(name)) return R.drawable.ic_w_fog;
        return R.drawable.ic_w_cloud;
    }

    static boolean isDarkGlass(Context context, String choice, boolean requestedDark) {
        if ("black".equals(choice)) return true;
        if ("white".equals(choice)) return false;
        if ("adaptive".equals(choice)) {
            return (context.getResources().getConfiguration().uiMode &
                Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        }
        return requestedDark;
    }

    /**
     * Text color is independent of both the weather glyph palette and glass
     * tint. "Adaptive" maximizes foreground contrast against the selected
     * glass and follows Android light/dark mode; manual white/black stay fixed.
     */
    static int[] textColors(Context context, String style, boolean dark,
                            String tint, int tone, int strength) {
        if ("white".equals(style)) return new int[]{ 0xFFFCFDFF, 0xFFE5EBF4 };
        if ("black".equals(style)) return new int[]{ 0xFF101C29, 0xFF334759 };
        int panel = glassTint(context, tint, dark, tone, strength);
        double luminance = 0.2126 * Color.red(panel) + 0.7152 * Color.green(panel) +
                           0.0722 * Color.blue(panel);
        boolean useLightInk = dark || luminance < 114;
        return useLightInk
            ? new int[]{ 0xFFFAFDFF, 0xFFE0EAF4 }
            : new int[]{ 0xFF142433, 0xFF344C60 };
    }

    /** Material You wallpaper-derived system palette on Android 12+.
     * No wallpaper image access, sensitive permissions or background sampler.
     * OEMs without a dynamic palette use our established ocean glass fallback.
     */
    static int glassTint(Context context, String choice, boolean dark, int tone, int strength) {
        if (!"adaptive".equals(choice)) return glassTint(choice, dark, tone, strength);
        int accent = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                int id = context.getResources().getIdentifier("system_accent1_500", "color", "android");
                if (id != 0) accent = context.getColor(id);
            } catch (RuntimeException ignored) { /* Samsung/OEM may omit dynamic palette */ }
        }
        if (accent == 0) accent = Color.parseColor(dark ? "#244C65" : "#91C6E7");
        float shade = Math.max(0f, Math.min(100f, tone)) / 100f;
        int toned = shade < 0.5f
            ? mixRgb(accent, dark ? 0xFF9FC4D4 : 0xFFE6F3FA, (0.5f - shade) * 0.80f)
            : mixRgb(accent, dark ? 0xFF0C1B31 : 0xFF294767, (shade - 0.5f) * 0.75f);
        return mixRgb(dark ? 0xFF65778B : 0xFFD7E2EB, toned,
            Math.max(0f, Math.min(1f, strength / 100f)));
    }

    /** Colors are separate from opacity: reducing opacity never forces a dark or white wash. */
    static int glassTint(String choice, boolean dark) {
        return glassTint(choice, dark, 50, 75);
    }

    /** Tone and color strength are separate from opacity. */
    static int glassTint(String choice, boolean dark, int tone, int strength) {
        if ("white".equals(choice)) return 0xFFF3F7FB;
        if ("black".equals(choice)) return 0xFF111926;
        int base;
        switch (choice == null ? "" : choice) {
            case "blue":   base = Color.parseColor(dark ? "#1D60C3" : "#75B8FA"); break;
            case "teal":   base = Color.parseColor(dark ? "#17474B" : "#80DDD1"); break;
            case "violet": base = Color.parseColor(dark ? "#433C85" : "#B8A9F8"); break;
            case "rose":   base = Color.parseColor(dark ? "#773E69" : "#F1A6DA"); break;
            default:       base = Color.parseColor(dark ? "#244C65" : "#91C6E7"); break;
        }
        float shade = Math.max(0f, Math.min(100f, tone)) / 100f;
        float saturation = Math.max(0f, Math.min(100f, strength)) / 100f;
        int pale = Color.parseColor(dark ? "#749CB9" : "#E7F5FC");
        int deep = Color.parseColor(dark ? "#081629" : "#193D75");
        int toned = shade < 0.5f
            ? mixRgb(base, pale, (0.5f - shade) * 0.85f)
            : mixRgb(base, deep, (shade - 0.5f) * 0.65f);
        int neutral = Color.parseColor(dark ? "#6F7C92" : "#DCE4EC");
        return mixRgb(neutral, toned, saturation);
    }

    private static int mixRgb(int a, int b, float weight) {
        float t = Math.max(0f, Math.min(1f, weight));
        return Color.rgb(
            Math.round(Color.red(a) * (1f - t) + Color.red(b) * t),
            Math.round(Color.green(a) * (1f - t) + Color.green(b) * t),
            Math.round(Color.blue(a) * (1f - t) + Color.blue(b) * t)
        );
    }

    /**
     * Siri-inspired luminous glass: translucent color field, soft radial light,
     * a thin upper-edge glint and a delicate inner border.
     *
     * Home-screen widgets cannot blur the wallpaper behind RemoteViews on
     * every launcher. Draw genuine alpha rather than simulating blur with an
     * opaque black or white layer. No timers, bitmap animation or battery cost.
     */
    static Bitmap glass(int w, int h, int alphaPct, boolean dark,
                        float density, String tintName, int tone, int strength, Context context) {
        int a = Math.round(255f * Math.max(10, Math.min(92, alphaPct)) / 100f);
        int tint = glassTint(context, tintName, dark, tone, strength);
        int topRgb = mixRgb(tint, Color.WHITE, dark ? 0.16f : 0.27f);
        int bottomRgb = mixRgb(tint, dark ? Color.BLACK : Color.WHITE, dark ? 0.17f : 0.07f);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        float r = 25f * Math.max(1f, density);
        float inset = Math.max(1.25f, density);
        RectF box = new RectF(inset, inset, w - inset, h - inset);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(new LinearGradient(0, 0, w * 0.22f, h,
            Color.argb(a, Color.red(topRgb), Color.green(topRgb), Color.blue(topRgb)),
            Color.argb(a, Color.red(bottomRgb), Color.green(bottomRgb), Color.blue(bottomRgb)),
            Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box, r, r, paint);
        // Interior frosted sheen follows requested opacity; does not wash out
        // the entire rectangle or block the live wallpaper.
        int glow = Math.min(100, Math.round(a * (dark ? 0.36f : 0.22f)));
        paint.setShader(new android.graphics.RadialGradient(
            w * 0.14f, h * 0.03f, Math.max(w * 0.72f, h),
            new int[]{ Color.argb(glow, 242, 253, 255),
                Color.argb(Math.round(glow * 0.25f), 188, 229, 255),
                Color.TRANSPARENT },
            new float[]{0f, 0.35f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box, r, r, paint);
        // Subtle bright rim and lower shadow give depth without a fixed
        // background resource underneath the alpha image.
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1.1f, 0.95f * density));
        paint.setColor(Color.argb(Math.min(190, 36 + Math.round(a * 0.58f)),
            226, 244, 255));
        canvas.drawRoundRect(box, r, r, paint);
        paint.setStrokeWidth(Math.max(1f, 0.55f * density));
        paint.setColor(Color.argb(Math.round(a * 0.23f), 20, 49, 85));
        canvas.drawRoundRect(new RectF(inset + density, inset + density,
            w - inset - density, h - inset - density), r - density, r - density, paint);
        return bmp;
    }

    public static final class Bridge {
        private final Context context;

        Bridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public void push(String json) {
            if (json == null) return;
            prefs(context).edit().putString(KEY_JSON, json).commit();
            updateAll(context);
        }

        @JavascriptInterface
        public boolean unmetered() {
            try {
                ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm == null) return true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network network = cm.getActiveNetwork();
                    if (network == null) return false;
                    NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                    if (caps == null) return true;
                    return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                        || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
                }
            } catch (Exception ignored) {
                return true;
            }
            return true;
        }

        @JavascriptInterface
        public void openSettings() {
            Intent intent = new Intent(context, WidgetSettingsActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(intent);
        }
    }
}
