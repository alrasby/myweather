package net.nabdhserv.myweather;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.os.Handler;
import android.view.MotionEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises Android's real composing-text protocol against the packaged city UI. */
@RunWith(AndroidJUnit4.class)
public class CitySearchInputTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private WebView web;

    private String evaluate(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitScript(String message, String condition) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(condition))) return;
            SystemClock.sleep(100);
        }
        fail(message + ": " + evaluate("document.body.innerText.slice(0,1200)"));
    }

    private void updateEditor(InputConnection connection, String text) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Boolean> accepted = new AtomicReference<>(false);
        AtomicReference<Throwable> error = new AtomicReference<>();
        Runnable update = () -> {
            try {
                accepted.set(text == null ? connection.finishComposingText() : connection.setComposingText(text, 1));
            } catch (Throwable failure) {
                error.set(failure);
            } finally {
                done.countDown();
            }
        };
        Handler handler = connection.getHandler();
        if (handler == null) instrumentation.runOnMainSync(update);
        else handler.post(update);
        assertTrue("InputConnection callback timed out", done.await(5, TimeUnit.SECONDS));
        if (error.get() != null) throw new AssertionError("InputConnection failed", error.get());
        assertTrue("InputConnection rejected composing text", accepted.get());
    }

    @Test
    public void completeArabicNamesUpdateDuringNativeComposition() throws Exception {
        Context context = instrumentation.getTargetContext();
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            instrumentation.runOnMainSync(() -> {
                assertFalse("captureInput substitutes a dummy IME connection", activity.getBridge().getConfig().isInputCaptured());
                web = activity.getBridge().getWebView();
            });
            awaitScript("Home did not mount", "!!document.querySelector('button[aria-label=\"Choose city\"],button[aria-label=\"اختيار المدينة\"]')");
            evaluate("document.querySelector('button[aria-label=\"Choose city\"],button[aria-label=\"اختيار المدينة\"]').click()");
            awaitScript("City search did not mount", "!!document.querySelector('input[type=search]')");
            String[][] cities = {
                {"برلين", "Berlin"}, {"مدريد", "Madrid"}, {"برشلونة", "Barcelona"},
                {"باريس", "Paris"}, {"الرياض", "Riyadh"}, {"الكويت", "Kuwait"}, {"الرباط", "Rabat"}
            };
            for (String[] city : cities) {
                evaluate("(() => { const input=document.querySelector('input[type=search]');"
                    + "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');"
                    + "input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return true;})()");
                awaitScript("Search did not focus", "document.activeElement===document.querySelector('input[type=search]')");
                JSONArray rect = new JSONArray(evaluate("(() => {const r=document.querySelector('input[type=search]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,devicePixelRatio];})()"));
                int[] origin = new int[2];
                instrumentation.runOnMainSync(() -> web.getLocationOnScreen(origin));
                float x = origin[0] + (float) (rect.getDouble(0) * rect.getDouble(2));
                float y = origin[1] + (float) (rect.getDouble(1) * rect.getDouble(2));
                long downTime = SystemClock.uptimeMillis();
                MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
                MotionEvent up = MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, x, y, 0);
                instrumentation.sendPointerSync(down);
                instrumentation.sendPointerSync(up);
                down.recycle();
                up.recycle();
                AtomicReference<InputConnection> editor = new AtomicReference<>();
                long editorDeadline = SystemClock.elapsedRealtime() + 10000;
                while (editor.get() == null && SystemClock.elapsedRealtime() < editorDeadline) {
                    instrumentation.runOnMainSync(() -> {
                        InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
                        keyboard.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
                        editor.set(web.onCreateInputConnection(new EditorInfo()));
                    });
                    if (editor.get() == null) SystemClock.sleep(100);
                }
                assertNotNull("Missing native WebView input connection", editor.get());
                assertNotEquals("Dummy input connection breaks composing text", BaseInputConnection.class, editor.get().getClass());
                for (int length = 1; length <= city[0].length(); length++) {
                    String prefix = city[0].substring(0, length);
                    updateEditor(editor.get(), prefix);
                    awaitScript("IME text missing: " + prefix, "document.querySelector('input[type=search]').value===" + JSONObject.quote(prefix));
                }
                String result = "document.querySelector('#wx-city-search-results')?.innerText||''";
                awaitScript("Full-name result missing before composition ends: " + city[0],
                    "(() => {const text=" + result + ";return text.includes(" + JSONObject.quote(city[0])
                        + ")||text.includes(" + JSONObject.quote(city[1]) + ");})()");
                updateEditor(editor.get(), null);
            }
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
