package net.nabdhserv.myweather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
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
        boolean dark = sp.getBoolean(KEY_DARK, false);
        int alpha = sp.getInt(KEY_ALPHA, 60);
        String tint = sp.getString(KEY_TINT, "ocean");
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
        int fg = dark ? Color.parseColor("#F7F8FA") : Color.parseColor("#142433");
        int muted = dark ? Color.parseColor("#C5CED6") : Color.parseColor("#3E5364");
        views.setTextViewText(R.id.city, data.optString("city", "طقسي"));
        views.setTextColor(R.id.city, muted);
        views.setTextViewText(R.id.temp, data.optString("temp", "--°"));
        views.setTextColor(R.id.temp, fg);
        float density = densityOf(context);
        int iconDp = iconDp(h, wide, tall);
        bindGlyph(views, data.optString("icon", "cloud"), dark, density, iconDp);
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
        if (forecast) bindDays(views, data, fg, dark, density);
        int wPx = Math.max(1, Math.round(Math.max(w, 110) * density));
        int hPx = Math.max(1, Math.round(Math.max(h, 40) * density));
        views.setImageViewBitmap(R.id.bg, glass(wPx, hPx, alpha, dark, density, tint));
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

    private static void bindGlyph(RemoteViews views, String name, boolean dark, float density, int dp) {
        int px = Math.max(96, Math.round(dp * density));
        Bitmap[] frames = WeatherGlyphs.frames(name, px, dark);
        views.setImageViewBitmap(R.id.icon_a, frames[0]);
    }

    private static void bindDays(RemoteViews views, JSONObject data, int fg, boolean dark, float density) {
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
            views.setImageViewBitmap(ICONS[i], WeatherGlyphs.frame(day.optString("icon", "cloud"), mark, dark, 0));
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

    /** Colors are separate from opacity: reducing opacity never forces a dark or white wash. */
    static int glassTint(String choice, boolean dark) {
        switch (choice == null ? "" : choice) {
            case "teal":   return Color.parseColor(dark ? "#17474B" : "#D0F0E9");
            case "violet": return Color.parseColor(dark ? "#37345C" : "#E8DFF7");
            case "rose":   return Color.parseColor(dark ? "#542F4D" : "#F4DFEC");
            default:       return Color.parseColor(dark ? "#173449" : "#D7E8F5");
        }
    }

    private static int mixRgb(int a, int b, float weight) {
        float t = Math.max(0f, Math.min(1f, weight));
        return Color.rgb(
            Math.round(Color.red(a) * (1f - t) + Color.red(b) * t),
            Math.round(Color.green(a) * (1f - t) + Color.green(b) * t),
            Math.round(Color.blue(a) * (1f - t) + Color.blue(b) * t)
        );
    }

    static Bitmap glass(int w, int h, int alphaPct, boolean dark, float density, String tintName) {
        // Alpha is *actual* alpha, including dark mode (no minimum 188 override).
        int a = Math.round(255f * Math.max(15, Math.min(95, alphaPct)) / 100f);
        int tint = glassTint(tintName, dark);
        int topRgb = mixRgb(tint, Color.WHITE, dark ? 0.13f : 0.10f);
        int bottomRgb = mixRgb(tint, dark ? Color.BLACK : Color.WHITE, dark ? 0.25f : 0.07f);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        float r = 22f * Math.max(1f, density);
        RectF box = new RectF(1.5f, 1.5f, w - 1.5f, h - 1.5f);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new LinearGradient(0, 0, w * 0.18f, h,
            Color.argb(a, Color.red(topRgb), Color.green(topRgb), Color.blue(topRgb)),
            Color.argb(a, Color.red(bottomRgb), Color.green(bottomRgb), Color.blue(bottomRgb)),
            Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box, r, r, paint);
        // A subtle highlight follows selected opacity, instead of turning a
        // transparent widget opaque with a second independent white gradient.
        int sheen = Math.round(a * (dark ? 0.12f : 0.24f));
        paint.setShader(new LinearGradient(0, 0, w * 0.4f, h * 0.64f,
            Color.argb(sheen, 255, 255, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box, r, r, paint);
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, density));
        paint.setColor(Color.argb(Math.min(180, Math.round(a * (dark ? 0.45f : 0.64f))),
            233, 246, 255));
        canvas.drawRoundRect(box, r, r, paint);
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
