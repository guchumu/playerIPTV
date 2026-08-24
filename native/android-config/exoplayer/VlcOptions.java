package PACKAGE_NAME;

import java.util.ArrayList;

/** Opciones compartidas de LibVLC para directo IPTV. */
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
        return opts;
    }
}
