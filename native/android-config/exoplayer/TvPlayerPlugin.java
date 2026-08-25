package PACKAGE_NAME;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reproductor nativo en TV: lanza VlcPlayerActivity (:vlc) o PlayerActivity (:exo)
 * según el motor que elija la web. No importa Media3/LibVLC en este proceso.
 */
@CapacitorPlugin(name = "NativePlayer")
public class TvPlayerPlugin extends Plugin {

    private String lastUrl = "";
    private String lastTitle = "";
    private String lastMime = "";
    private String lastEngine = "vlc";
    private boolean receiverOn;

    private final BroadcastReceiver finishedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            emit(true, false);
        }
    };

    @Override
    public void load() {
        registrarFinished();
    }

    private void registrarFinished() {
        if (receiverOn) return;
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(ctx.getPackageName() + ".VLC_FINISHED");
            filter.addAction(ctx.getPackageName() + ".EXO_FINISHED");
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(finishedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ctx.registerReceiver(finishedReceiver, filter);
            }
            receiverOn = true;
        } catch (Throwable ignored) {}
    }

    private static String normalizarEngine(String raw) {
        if (raw == null) return "vlc";
        String e = raw.trim().toLowerCase();
        if ("exo".equals(e) || "exoplayer".equals(e) || "media3".equals(e)) return "exo";
        return "vlc";
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL del canal");
            return;
        }
        String title = call.getString("title", "");
        String mime = call.getString("mime", "");
        lastUrl = url;
        lastTitle = title == null ? "" : title;
        lastMime = mime == null ? "" : mime;
        lastEngine = normalizarEngine(call.getString("engine", lastEngine));
        Activity act = getActivity();
        if (act == null) {
            call.reject("Sin actividad");
            return;
        }
        act.runOnUiThread(() -> {
            try {
                lanzar(act, lastUrl, lastTitle, lastMime, lastEngine);
                call.resolve(ok(true, true));
                emit(false, true);
            } catch (Throwable t) {
                String msg = t.getMessage() != null ? t.getMessage() : "No se pudo abrir el reproductor";
                call.reject(msg);
            }
        });
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean wantFs = Boolean.TRUE.equals(call.getBoolean("fullscreen", false));
        Activity act = getActivity();
        if (wantFs && lastUrl != null && !lastUrl.isEmpty()) {
            try {
                lastEngine = normalizarEngine(call.getString("engine", lastEngine));
                lanzar(act, lastUrl, lastTitle, lastMime, lastEngine);
            } catch (Throwable ignored) {}
            call.resolve(ok(true, true));
            emit(false, true);
            return;
        }
        if (!wantFs) stopPlayers();
        call.resolve(ok(true, false));
    }

    @PluginMethod
    public void layout(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopPlayers();
        emit(true, false);
        call.resolve();
    }

    @PluginMethod
    public void getEngine(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("engine", lastEngine);
        ret.put("isTv", true);
        ret.put("hasExo", true);
        ret.put("hasVlc", true);
        call.resolve(ret);
    }

    private JSObject ok(boolean playing, boolean fs) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", playing);
        ret.put("fullscreen", fs);
        ret.put("engine", lastEngine);
        return ret;
    }

    private void emit(boolean stopped, boolean fs) {
        JSObject ev = new JSObject();
        ev.put("stopped", stopped);
        ev.put("fullscreen", fs);
        ev.put("engine", lastEngine);
        notifyListeners("nativePlayer", ev);
    }

    private void stopPlayers() {
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            Intent vlc = new Intent(ctx.getPackageName() + ".STOP_VLC");
            vlc.setPackage(ctx.getPackageName());
            ctx.sendBroadcast(vlc);
        } catch (Throwable ignored) {}
        try {
            Intent exo = new Intent(ctx.getPackageName() + ".STOP_EXO");
            exo.setPackage(ctx.getPackageName());
            ctx.sendBroadcast(exo);
        } catch (Throwable ignored) {}
    }

    private void lanzar(Activity act, String url, String title, String mime, String engine) {
        Context ctx = getContext();
        if (ctx == null) throw new IllegalStateException("Sin contexto");
        // Cerrar el otro motor si estaba abierto.
        stopPlayers();
        Intent intent = new Intent();
        String cls = "exo".equals(engine) ? ".PlayerActivity" : ".VlcPlayerActivity";
        intent.setClassName(ctx.getPackageName(), ctx.getPackageName() + cls);
        intent.putExtra("url", url);
        intent.putExtra("title", title == null ? "" : title);
        if ("exo".equals(engine)) {
            intent.putExtra("mime", mime == null ? "" : mime);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (act != null) {
            act.startActivity(intent);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        }
    }
}
