package net.nabdhserv.myweather;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONArray;
import org.json.JSONObject;

public class WidgetSettingsActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private boolean configuring;
    private int alpha = 60;
    private String tint = "ocean";
    private boolean dark;
    private boolean clock;
    private String placeId = "";
    private LinearLayout cities;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_widget_settings);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        configuring = widgetId != AppWidgetManager.INVALID_APPWIDGET_ID;
        if (configuring) {
            Intent data = new Intent();
            data.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_CANCELED, data);
        }
        SharedPreferences sp = WeatherWidget.prefs(this);
        alpha = sp.getInt(WeatherWidget.KEY_ALPHA, 60);
        tint = sp.getString(WeatherWidget.KEY_TINT, "ocean");
        dark = sp.getBoolean(WeatherWidget.KEY_DARK, false);
        clock = sp.getBoolean(WeatherWidget.KEY_CLOCK, false);
        placeId = sp.getString(WeatherWidget.KEY_PLACE, "");

        ((TextView) findViewById(R.id.title)).setText(getString(R.string.widget_config_title));
        ((TextView) findViewById(R.id.hint)).setText(getString(R.string.widget_desc));
        ((TextView) findViewById(R.id.labelAlpha)).setText(getString(R.string.widget_opacity));
        ((TextView) findViewById(R.id.labelTheme)).setText(getString(R.string.widget_theme));
        ((TextView) findViewById(R.id.labelTint)).setText(getString(R.string.widget_tint));
        ((TextView) findViewById(R.id.tintOcean)).setText(getString(R.string.widget_tint_ocean));
        ((TextView) findViewById(R.id.tintTeal)).setText(getString(R.string.widget_tint_teal));
        ((TextView) findViewById(R.id.tintViolet)).setText(getString(R.string.widget_tint_violet));
        ((TextView) findViewById(R.id.tintRose)).setText(getString(R.string.widget_tint_rose));
        ((TextView) findViewById(R.id.labelStyle)).setText(getString(R.string.widget_style));
        ((TextView) findViewById(R.id.labelCity)).setText(getString(R.string.widget_city));
        ((TextView) findViewById(R.id.light)).setText(getString(R.string.widget_light));
        ((TextView) findViewById(R.id.dark)).setText(getString(R.string.widget_dark));
        ((TextView) findViewById(R.id.styleWeather)).setText(getString(R.string.widget_style_weather));
        ((TextView) findViewById(R.id.styleClock)).setText(getString(R.string.widget_style_clock));
        ((TextView) findViewById(R.id.done)).setText(getString(R.string.widget_done));

        SeekBar bar = findViewById(R.id.alpha);
        bar.setProgress(Math.max(0, Math.min(80, alpha - 15)));
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                alpha = progress + 15;
                showAlpha();
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {}

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
                save();
            }
        });
        findViewById(R.id.light).setOnClickListener(v -> {
            dark = false;
            save();
        });
        findViewById(R.id.dark).setOnClickListener(v -> {
            dark = true;
            save();
        });
        bindTint(R.id.tintOcean, "ocean");
        bindTint(R.id.tintTeal, "teal");
        bindTint(R.id.tintViolet, "violet");
        bindTint(R.id.tintRose, "rose");
        findViewById(R.id.styleWeather).setOnClickListener(v -> {
            clock = false;
            save();
        });
        findViewById(R.id.styleClock).setOnClickListener(v -> {
            clock = true;
            save();
        });
        findViewById(R.id.done).setOnClickListener(v -> finishOk());
        cities = findViewById(R.id.cities);
        showAlpha();
        paintChips();
        buildCities();
    }

    private void showAlpha() {
        ((TextView) findViewById(R.id.alphaValue)).setText(alpha + "%");
    }

    private void paintChips() {
        chip(R.id.light, !dark);
        chip(R.id.dark, dark);
        chip(R.id.styleWeather, !clock);
        chip(R.id.styleClock, clock);
        tintChip(R.id.tintOcean, "ocean");
        tintChip(R.id.tintTeal, "teal");
        tintChip(R.id.tintViolet, "violet");
        tintChip(R.id.tintRose, "rose");
    }

    private void chip(int id, boolean on) {
        TextView view = findViewById(id);
        view.setBackgroundResource(on ? R.drawable.widget_chip_on : R.drawable.widget_chip);
        view.setTextColor(on ? 0xFFFFFFFF : 0xFF1C1C1E);
    }

    private void bindTint(int id, String name) {
        findViewById(id).setOnClickListener(v -> {
            tint = name;
            save();
        });
    }

    private void tintChip(int id, String name) {
        TextView view = findViewById(id);
        boolean selected = name.equals(tint);
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(18));
        background.setColor(WeatherWidget.glassTint(name, dark));
        background.setStroke(dp(selected ? 3 : 1), selected ? 0xFFDEA73D : 0xFF98A7B6);
        view.setBackground(background);
        view.setTextColor(dark ? Color.WHITE : Color.rgb(18, 35, 53));
    }

    private void save() {
        WeatherWidget.prefs(this).edit()
            .putInt(WeatherWidget.KEY_ALPHA, alpha)
            .putString(WeatherWidget.KEY_TINT, tint)
            .putBoolean(WeatherWidget.KEY_DARK, dark)
            .putBoolean(WeatherWidget.KEY_CLOCK, clock)
            .putString(WeatherWidget.KEY_PLACE, placeId == null ? "" : placeId)
            .commit();
        paintChips();
        paintCities();
        WeatherWidget.updateAll(this);
    }

    private void buildCities() {
        cities.removeAllViews();
        addCity("@here", getString(R.string.widget_here));
        JSONObject root = WeatherWidget.readPayload(WeatherWidget.prefs(this));
        JSONArray list = root.optJSONArray("cities");
        if (list == null || list.length() == 0) {
            addCity(root.optString("id", ""), root.optString("city", getString(R.string.app_name)));
        } else {
            for (int i = 0; i < list.length(); i++) {
                JSONObject city = list.optJSONObject(i);
                if (city == null) continue;
                String id = city.optString("id", "");
                if ("@here".equals(id)) continue;
                addCity(id, city.optString("city", ""));
            }
        }
        if (cities.getChildCount() == 1 && root.optString("id", "").isEmpty()) {
            /* موقعي فقط حين لا توجد مدينة محفوظة بعد */
        }
        paintCities();
    }

    private void addCity(String id, String name) {
        TextView view = new TextView(this);
        view.setText(name == null || name.isEmpty() ? getString(R.string.app_name) : name);
        view.setTag(id == null ? "" : id);
        view.setGravity(Gravity.CENTER);
        view.setTextSize(15);
        int pad = dp(12);
        view.setPadding(pad, pad, pad, pad);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        view.setLayoutParams(lp);
        view.setOnClickListener(v -> {
            placeId = String.valueOf(v.getTag());
            save();
        });
        cities.addView(view);
    }

    private void paintCities() {
        String active = WeatherWidget.readPayload(WeatherWidget.prefs(this)).optString("id", "");
        String chosen = placeId == null ? "" : placeId;
        if (chosen.isEmpty()) chosen = active;
        boolean known = false;
        for (int i = 0; i < cities.getChildCount(); i++) {
            View child = cities.getChildAt(i);
            if (child.getTag() != null && chosen.equals(String.valueOf(child.getTag()))) known = true;
        }
        boolean fallbackUsed = false;
        for (int i = 0; i < cities.getChildCount(); i++) {
            View child = cities.getChildAt(i);
            if (!(child instanceof TextView)) continue;
            TextView view = (TextView) child;
            String id = child.getTag() == null ? "" : String.valueOf(child.getTag());
            boolean on = known ? id.equals(chosen) : !"@here".equals(id) && !fallbackUsed;
            if (on && !known) fallbackUsed = true;
            view.setBackgroundResource(on ? R.drawable.widget_chip_on : R.drawable.widget_chip);
            view.setTextColor(on ? 0xFFFFFFFF : 0xFF1C1C1E);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void finishOk() {
        save();
        if (configuring) {
            Intent data = new Intent();
            data.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_OK, data);
        }
        finish();
    }

    @Override
    public void onBackPressed() {
        if (configuring) {
            Intent data = new Intent();
            data.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_CANCELED, data);
        }
        super.onBackPressed();
    }
}
