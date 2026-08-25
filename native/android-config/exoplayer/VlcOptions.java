package PACKAGE_NAME;

import java.util.ArrayList;

/**
 * Opciones de LibVLC para directo IPTV.
 *
 * En Google TV Streamer / chips MediaTek el decoder HW (MediaCodec) suele
 * congelar el vídeo y dejar el audio. Por eso en TV forzamos software.
 */
public final class VlcOptions {
    private VlcOptions() {}

    public static ArrayList<String> base() {
        ArrayList<String> opts = new ArrayList<>();
        opts.add("--aout=opensles");
        opts.add("--audio-time-stretch");
        opts.add("--network-caching=2000");
        opts.add("--live-caching=2000");
        opts.add("--file-caching=2000");
        opts.add("--clock-jitter=0");
        opts.add("--clock-synchro=0");
        opts.add("--drop-late-frames");
        opts.add("--skip-frames");
        opts.add("--http-reconnect");
        opts.add("--no-stats");
        // Sin HW: el MediaCodec del Streamer congela tras 1–2 frames.
        opts.add("--avcodec-hw=none");
        return opts;
    }
}
