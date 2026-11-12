package net.nabdhserv.myweather;

import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.GeomagneticField;
import android.hardware.SensorManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private CompassBridge compass;
    private boolean compassBound;
    private boolean widgetBound;
    private boolean returnHome;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(0xFF0C1424);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            pushStatusInset();
            return insets;
        });
        ViewCompat.requestApplyInsets(getWindow().getDecorView());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        showHome();
    }

    @Override
    public void onUserLeaveHint() {
        returnHome = true;
        super.onUserLeaveHint();
    }

    @Override
    public void onStop() {
        if (!isChangingConfigurations()) returnHome = true;
        super.onStop();
    }

    @Override
    public void onResume() {
        super.onResume();
        ensureCompass();
        if (compass != null) compass.onHostResume();
        ensureWidget();
        pushStatusInset();
        if (returnHome) {
            returnHome = false;
            showHome();
        }
    }

    private void showHome() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView web = getBridge().getWebView();
        web.post(() -> web.evaluateJavascript(
            "(function(){try{sessionStorage.setItem('myweather-home','1')}catch(e){}if(window.__wxHome)window.__wxHome()})()",
            null
        ));
    }

    @Override
    public void onPause() {
        if (compass != null) compass.onHostPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        // The WebView's JavascriptInterfaces retain their Java bridge objects;
        // the compass bridge in turn retains this Activity. Release both before
        // Capacitor tears down its WebView to avoid a stale Activity/sensor leak.
        if (compass != null) {
            compass.dispose();
            compass = null;
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView web = getBridge().getWebView();
            if (compassBound) web.removeJavascriptInterface("AndroidCompass");
            if (widgetBound) web.removeJavascriptInterface("AndroidWidget");
        }
        compassBound = false;
        widgetBound = false;
        super.onDestroy();
    }

    private void ensureWidget() {
        if (widgetBound || getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().addJavascriptInterface(new WeatherWidget.Bridge(this), "AndroidWidget");
        widgetBound = true;
    }

    private void ensureCompass() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView web = getBridge().getWebView();
        if (compass == null) compass = new CompassBridge(this);
        compass.attach(web);
        if (!compassBound) {
            web.addJavascriptInterface(compass, "AndroidCompass");
            compassBound = true;
        }
    }

    private void pushStatusInset() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        int top = 0;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
        if (insets != null) top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
        if (top <= 0) {
            int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (id > 0) top = getResources().getDimensionPixelSize(id);
        }
        float density = getResources().getDisplayMetrics().density;
        float dip = density > 0 ? top / density : 0;
        String js = "(function(){var s=function(){document.documentElement.style.setProperty('--sat','"
            + String.format(Locale.US, "%.1f", dip)
            + "px')};if(document.documentElement)s();else document.addEventListener('DOMContentLoaded',s);})()";
        WebView web = getBridge().getWebView();
        web.post(() -> web.evaluateJavascript(js, null));
    }

    public static final class CompassBridge implements SensorEventListener {
        private final MainActivity activity;
        private final Handler main = new Handler(Looper.getMainLooper());
        private WebView web;
        private SensorManager sensors;
        private boolean listening;
        private boolean requested;
        private boolean foreground;
        private float last = -999f;
        private float declination = 0f;
        private boolean hasLocation;
        private int accuracy = SensorManager.SENSOR_STATUS_UNRELIABLE;

        CompassBridge(MainActivity activity) {
            this.activity = activity;
        }

        void attach(WebView web) {
            this.web = web;
        }

        @JavascriptInterface
        public void setLocation(double lat, double lon) {
            main.post(() -> {
                if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                    hasLocation = false;
                    last = -999f; // Publish uncorrected status even if phone is stationary.
                    return;
                }
                declination = new GeomagneticField((float) lat, (float) lon, 0f, System.currentTimeMillis()).getDeclination();
                hasLocation = true;
                last = -999f;
            });
        }

        @JavascriptInterface
        public void start() {
            main.post(() -> {
                requested = true;
                listen();
            });
        }

        @JavascriptInterface
        public void stop() {
            main.post(() -> {
                requested = false;
                halt();
            });
        }

        void onHostPause() {
            foreground = false;
            halt();
        }

        void onHostResume() {
            foreground = true;
            if (requested) listen();
        }

        void dispose() {
            requested = false;
            foreground = false;
            halt();
            // Our Handler owns only compass callbacks; do not clear another
            // component's posted tasks or the main thread globally.
            main.removeCallbacksAndMessages(null);
            web = null;
            sensors = null;
        }

        private void listen() {
            if (!foreground || !requested || listening || web == null) return;
            sensors = (SensorManager) activity.getSystemService(SENSOR_SERVICE);
            if (sensors == null) return;
            Sensor sensor = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (sensor == null) sensor = sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
            if (sensor == null) return;
            listening = sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME, main);
        }

        private void halt() {
            if (sensors != null && listening) sensors.unregisterListener(this);
            listening = false;
            last = -999f;
        }

        @Override
        public void onSensorChanged(SensorEvent event) {
            if (web == null || event.values == null) return;
            float[] rotation = new float[9];
            float[] remapped = new float[9];
            float[] orientation = new float[3];
            SensorManager.getRotationMatrixFromVector(rotation, event.values);
            int x = SensorManager.AXIS_X;
            int y = SensorManager.AXIS_Y;
            int display = Surface.ROTATION_0;
            try {
                display = activity.getWindowManager().getDefaultDisplay().getRotation();
            } catch (RuntimeException ignored) {
                display = Surface.ROTATION_0;
            }
            if (display == Surface.ROTATION_90) {
                x = SensorManager.AXIS_Y;
                y = SensorManager.AXIS_MINUS_X;
            } else if (display == Surface.ROTATION_180) {
                x = SensorManager.AXIS_MINUS_X;
                y = SensorManager.AXIS_MINUS_Y;
            } else if (display == Surface.ROTATION_270) {
                x = SensorManager.AXIS_MINUS_Y;
                y = SensorManager.AXIS_X;
            }
            if (!SensorManager.remapCoordinateSystem(rotation, x, y, remapped)) return;
            SensorManager.getOrientation(remapped, orientation);
            float deg = (float) Math.toDegrees(orientation[0]);
            // Android azimuth is magnetic-north referenced. Convert to true north
            // with the geomagnetic model for the currently selected location.
            if (hasLocation) deg += declination;
            deg = ((deg % 360f) + 360f) % 360f;
            float delta = deg - last;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            if (Math.abs(delta) < 0.6f) return;
            last = deg;
            String js = "window.__wxHeadingMeta&&window.__wxHeadingMeta(" +
                String.format(Locale.US, "%.2f", deg) + "," + accuracy + "," + hasLocation + ")";
            web.evaluateJavascript(js, null);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            if (this.accuracy != accuracy) {
                this.accuracy = accuracy;
                // Publish calibration change even when the device is stationary.
                last = -999f;
            }
        }
    }
}
