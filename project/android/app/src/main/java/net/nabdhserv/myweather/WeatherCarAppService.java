package net.nabdhserv.myweather;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.car.app.validation.HostValidator;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Driver-safe Android Auto forecast summary.
 * Uses the same bounded forecast snapshot published for the Android widget;
 * no second network client, background polling, car WebView or phone UI mirroring.
 *
 * This is a first, deliberately limited car surface. Real host certification,
 * live route weather, maps and AAOS packaging require further work.
 */
public final class WeatherCarAppService extends CarAppService {
    @NonNull
    @Override
    public HostValidator createHostValidator() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        }
        return new HostValidator.Builder(this)
            .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
            .build();
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new Session() {
            @NonNull
            @Override
            public Screen onCreateScreen(@NonNull Intent intent) {
                return new WeatherScreen(getCarContext());
            }
        };
    }

    private static final class WeatherScreen extends Screen {
        WeatherScreen(@NonNull CarContext context) {
            super(context);
        }

        @NonNull
        @Override
        public Template onGetTemplate() {
            JSONObject payload = WeatherWidget.readPayload(WeatherWidget.prefs(getCarContext()));
            ItemList.Builder rows = new ItemList.Builder();
            String city = payload.optString("city", "").trim();
            String temp = payload.optString("temp", "").trim();
            if (city.isEmpty() || temp.isEmpty() || "--°".equals(temp)) {
                rows.addItem(new Row.Builder()
                    .setTitle("Weather data unavailable")
                    .addText("Open MyWeather on your phone to refresh its forecast.")
                    .build());
            } else {
                String condition = payload.optString("condition", "").trim();
                String hilo = payload.optString("hilo", "").trim();
                rows.addItem(new Row.Builder().setTitle(city)
                    .addText(temp + (condition.isEmpty() ? "" : " · " + condition))
                    .build());
                if (!hilo.isEmpty()) {
                    rows.addItem(new Row.Builder()
                        .setTitle("High / low")
                        .addText(hilo)
                        .build());
                }
                JSONArray days = payload.optJSONArray("days");
                if (days != null) {
                    for (int i = 0; i < Math.min(days.length(), 4); i++) {
                        JSONObject day = days.optJSONObject(i);
                        if (day == null) continue;
                        String name = day.optString("name", "").trim();
                        String range = day.optString("temp", "").trim();
                        if (name.isEmpty() || range.isEmpty()) continue;
                        rows.addItem(new Row.Builder().setTitle(name).addText(range).build());
                    }
                }
            }
            return new ListTemplate.Builder()
                .setTitle("MyWeather")
                .setHeaderAction(Action.APP_ICON)
                .setSingleList(rows.build())
                .build();
        }
    }
}
