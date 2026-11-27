package net.nabdhserv.myweather;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Verify the real system-bar state, not a browser imitation of Android icons. */
@RunWith(AndroidJUnit4.class)
public class StatusBarContrastTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private WebView web;

    private String evaluate(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(script, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue("Status-bar JS callback timed out", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitScript(String script) throws Exception {
        long until = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < until) {
            if ("true".equals(evaluate(script))) return;
            SystemClock.sleep(100);
        }
        fail("Status-bar surface did not become ready: " + script);
    }

    @Test
    public void lightIconsStayVisibleOnEveryTab() throws Exception {
        Context context = instrumentation.getTargetContext();
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            instrumentation.runOnMainSync(() -> web = activity.getBridge().getWebView());
            awaitScript("document.querySelectorAll('.wx-bottom-nav button').length===3 && !!document.querySelector('.wx-status-scrim')");
            String mode = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
            File dir = context.getExternalFilesDir("statusbar-qa");
            assertNotNull(dir);
            assertTrue(dir.isDirectory() || dir.mkdirs());
            for (int tab : new int[] {0, 2, 1}) {
                evaluate("setTimeout(()=>document.querySelectorAll('.wx-bottom-nav button')[" + tab + "].click(),0);true");
                String surface = tab == 0 ? ".wx-home" : tab == 2 ? ".wx-settings" : ".map-stage";
                awaitScript("!!document.querySelector('" + surface + "') && getComputedStyle(document.querySelector('.wx-status-scrim')).height!=='0px'");
                instrumentation.runOnMainSync(() -> {
                    assertFalse("Dark icons disappear on the dark sky surface",
                        WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView()).isAppearanceLightStatusBars());
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                    assertNotNull(insets);
                    assertTrue("Status bar must remain visible", insets.isVisible(WindowInsetsCompat.Type.statusBars()));
                });
                JSONArray box = new JSONArray(evaluate("(()=>{const e=document.querySelector('.wx-status-scrim'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return [r.top,r.height,devicePixelRatio,s.backgroundColor,s.pointerEvents]})()"));
                assertEquals(0, box.getDouble(0), 0.1);
                assertEquals("rgb(12, 20, 36)", box.getString(3));
                assertEquals("none", box.getString(4));
                AtomicReference<Integer> nativeTop = new AtomicReference<>(0);
                instrumentation.runOnMainSync(() -> nativeTop.set(ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView()).getInsets(WindowInsetsCompat.Type.statusBars()).top));
                assertEquals("Backdrop must cover exactly the status area",
                    nativeTop.get().doubleValue(), box.getDouble(1) * box.getDouble(2), 2.0);
                Bitmap image = instrumentation.getUiAutomation().takeScreenshot();
                assertNotNull(image);
                try (FileOutputStream file = new FileOutputStream(new File(dir, mode + "-tab" + tab + ".png"))) {
                    assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, file));
                } finally { image.recycle(); }
            }
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
