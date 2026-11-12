package net.nabdhserv.myweather;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;

/** أيقونات طقس مرسومة نظيفة، بثلاث لقطات حتى تتحرك داخل الويدجت. */
public final class WeatherGlyphs {
    private WeatherGlyphs() {}

    public static Bitmap[] frames(String kind, int px, boolean dark) {
        Bitmap[] out = new Bitmap[3];
        for (int i = 0; i < 3; i++) out[i] = frame(kind, px, dark, i);
        return out;
    }

    public static Bitmap frame(String kind, int px, boolean dark, int step) {
        int size = Math.max(24, px);
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.scale(size / 48f, size / 48f);
        draw(canvas, kind == null ? "cloud" : kind, dark, step);
        return bmp;
    }

    private static void draw(Canvas canvas, String kind, boolean dark, int step) {
        // Weather icons remain colorful and semantic regardless of widget text
        // preset (Adaptive/White/Black). The dark parameter is retained for
        // source compatibility but cannot recolor condition-specific glyphs.
        int cloud = Color.parseColor("#8FB5CD");
        if ("partly".equals(kind) || "partly-night".equals(kind)) cloud = Color.parseColor("#C6DFEE");
        else if ("rain".equals(kind)) cloud = Color.parseColor("#779DBB");
        else if ("snow".equals(kind)) cloud = Color.parseColor("#A3BDD3");
        else if ("storm".equals(kind)) cloud = Color.parseColor("#657E9D");
        else if ("fog".equals(kind)) cloud = Color.parseColor("#B3C7D4");
        int drop = Color.parseColor("#25A4ED");
        int snow = Color.parseColor("#ECF9FF");
        if ("sun".equals(kind)) {
            sun(canvas, 24f, 24f, 8.6f, step * 18f);
            return;
        }
        if ("moon".equals(kind)) {
            moon(canvas, 23f, 24f, 11f, step);
            return;
        }
        if ("partly".equals(kind)) {
            sun(canvas, 31f, 16f, 6.2f, step * 16f);
            cloud(canvas, 20f + step * 0.8f, 30f, 1f, cloud);
            return;
        }
        if ("partly-night".equals(kind)) {
            moon(canvas, 31f, 16f, 7f, step);
            cloud(canvas, 20f + step * 0.8f, 31f, 1f, cloud);
            return;
        }
        if ("rain".equals(kind)) {
            cloud(canvas, 24f, 18f, 0.92f, cloud);
            drops(canvas, step, drop);
            return;
        }
        if ("snow".equals(kind)) {
            cloud(canvas, 24f, 18f, 0.92f, cloud);
            flakes(canvas, step, snow);
            return;
        }
        if ("storm".equals(kind)) {
            cloud(canvas, 24f, 17f, 0.92f, cloud);
            bolt(canvas, step == 1 ? Color.parseColor("#FFE08A") : Color.parseColor("#F0B429"));
            return;
        }
        if ("fog".equals(kind)) {
            fog(canvas, step, cloud);
            return;
        }
        cloud(canvas, 24f + (step - 1) * 0.28f, 25.2f, 1.62f, cloud);
    }

    private static void sun(Canvas canvas, float cx, float cy, float r, float turn) {
        Paint ray = paint(Color.parseColor("#FFE08A"));
        ray.setStyle(Paint.Style.STROKE);
        ray.setStrokeWidth(2.2f);
        ray.setStrokeCap(Paint.Cap.ROUND);
        canvas.save();
        canvas.rotate(turn, cx, cy);
        for (int i = 0; i < 8; i++) {
            canvas.save();
            canvas.rotate(i * 45f, cx, cy);
            canvas.drawLine(cx, cy - r - 5.2f, cx, cy - r - 1.6f, ray);
            canvas.restore();
        }
        canvas.restore();
        canvas.drawCircle(cx, cy, r, paint(Color.parseColor("#F6C445")));
    }

    private static void moon(Canvas canvas, float cx, float cy, float r, int step) {
        canvas.drawCircle(cx, cy, r, paint(Color.parseColor("#F4E7B8")));
        Paint cut = paint(Color.TRANSPARENT);
        cut.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
        canvas.drawCircle(cx + r * 0.48f + step * 0.4f, cy - r * 0.22f, r * 0.78f, cut);
    }

    private static void cloud(Canvas canvas, float cx, float cy, float sc, int color) {
        Paint p = paint(color);
        canvas.drawCircle(cx - 7f * sc, cy + 1.5f * sc, 6.2f * sc, p);
        canvas.drawCircle(cx, cy - 3f * sc, 8f * sc, p);
        canvas.drawCircle(cx + 8f * sc, cy + 1.2f * sc, 6.4f * sc, p);
        canvas.drawRoundRect(cx - 13f * sc, cy, cx + 14f * sc, cy + 8.5f * sc, 5f * sc, 5f * sc, p);
    }

    private static void drops(Canvas canvas, int step, int color) {
        Paint p = paint(color);
        float[] xs = {16f, 24f, 32f};
        for (int i = 0; i < xs.length; i++) {
            float y = 30f + ((step * 4f + i * 3.5f) % 11f);
            canvas.drawRoundRect(xs[i], y, xs[i] + 2.1f, y + 6.2f, 1.2f, 1.2f, p);
        }
    }

    private static void flakes(Canvas canvas, int step, int color) {
        Paint p = paint(color);
        float[] xs = {16f, 24f, 33f};
        for (int i = 0; i < xs.length; i++) {
            float y = 31f + ((step * 3.5f + i * 4f) % 10f);
            canvas.drawCircle(xs[i], y, 1.7f, p);
        }
    }

    private static void bolt(Canvas canvas, int color) {
        Path path = new Path();
        path.moveTo(27f, 24f);
        path.lineTo(20f, 33f);
        path.lineTo(24.5f, 33f);
        path.lineTo(21f, 42f);
        path.lineTo(31f, 30.5f);
        path.lineTo(26f, 30.5f);
        path.close();
        canvas.drawPath(path, paint(color));
    }

    private static void fog(Canvas canvas, int step, int color) {
        Paint p = paint(color);
        float shift = (step - 1) * 1.4f;
        canvas.drawRoundRect(10f + shift, 16f, 36f + shift, 19.2f, 2f, 2f, p);
        p.setAlpha(170);
        canvas.drawRoundRect(13f - shift, 24f, 37f - shift, 27.2f, 2f, 2f, p);
        p.setAlpha(120);
        canvas.drawRoundRect(11f + shift, 32f, 33f + shift, 35.2f, 2f, 2f, p);
    }

    private static Paint paint(int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        return p;
    }
}
