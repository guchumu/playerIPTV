package PACKAGE_NAME;

import android.media.audiofx.LoudnessEnhancer;
import androidx.media3.exoplayer.ExoPlayer;

/**
 * Volumen por encima del 100% del aparato: ganancia lineal 1–3 (100–300%).
 */
public final class AudioBoost {
    public static volatile float last = 1f;

    private AudioBoost() {}

    public static float clamp(float v) {
        if (Float.isNaN(v) || v < 1f) return 1f;
        if (v > 3f) return 3f;
        return v;
    }

    public static int vlcPercent(float boost) {
        return Math.min(300, Math.max(0, Math.round(clamp(boost) * 100f)));
    }

    public static LoudnessEnhancer attach(ExoPlayer player, LoudnessEnhancer prev, float boost) {
        if (prev != null) {
            try {
                prev.release();
            } catch (Throwable ignored) {}
        }
        if (player == null) return null;
        float b = clamp(boost);
        last = b;
        if (b <= 1.01f) return null;
        int session = 0;
        try {
            session = player.getAudioSessionId();
        } catch (Throwable ignored) {}
        if (session == 0) return null;
        try {
            LoudnessEnhancer e = new LoudnessEnhancer(session);
            double db = 20.0 * Math.log10(b);
            int mb = (int) Math.round(db * 100.0);
            if (mb < 0) mb = 0;
            if (mb > 1500) mb = 1500;
            e.setTargetGain(mb);
            e.setEnabled(true);
            return e;
        } catch (Throwable ignored) {
            return null;
        }
    }
}
