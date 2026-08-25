package PACKAGE_NAME;

import java.util.ArrayList;

/**
 * Opciones de LibVLC para directo IPTV en Android TV.
 *
 * Evitar --aout=opensles y --avcodec-hw=none: en Google Streamer (MediaTek)
 * esas dos han llegado a abortar el proceso al pulsar un canal.
 */
public final class VlcOptions {
    private VlcOptions() {}

    public static ArrayList<String> base() {
        ArrayList<String> opts = new ArrayList<>();
        opts.add("--audio-time-stretch");
        opts.add("--network-caching=2000");
        opts.add("--live-caching=2000");
        opts.add("--file-caching=2000");
        opts.add("--http-reconnect");
        opts.add("--no-stats");
        return opts;
    }
}
