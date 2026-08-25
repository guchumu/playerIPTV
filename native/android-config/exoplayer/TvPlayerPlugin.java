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
 * Reproductor nativo en TV: solo lanza VlcPlayerActivity en el proceso :vlc.
 *
 * No importa Media3 ni LibVLC. En Google Streamer, cargar ExoPlayer/LibVLC
 * en el mismo proceso que el WebView abortaba al mover el mando aunque no
 * se estuviera reproduciendo nada.
 */
@CapacitorPlugin(name = "NativePlayer")
public class TvPlayerPlugin extends Plugin {

    private String lastUrl = "";
    private String lastTitle = "";
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
        IntentFilter filter = new IntentFilter(ctx.getPackageName() + ".VLC_FINISHED");
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(finishedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ctx.registerReceiver(finishedReceiver, filter);
            }
            receiverOn = true;
        } catch (Throwable ignored) {}
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL del canal");
            return;
        }
        String title = call.getString("title", "");
        lastUrl = url;
        lastTitle = title == null ? "" : title;
        Activity act = getActivity();
        if (act == null) {
            call.reject("Sin actividad");
            return;
        }
        act.runOnUiThread(() -> {
            try {
                lanzarVlc(act, lastUrl, lastTitle);
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
                lanzarVlc(act, lastUrl, lastTitle);
            } catch (Throwable ignored) {}
            call.resolve(ok(true, true));
            emit(false, true);
            return;
        }
        if (!wantFs) stopVlc();
        call.resolve(ok(true, false));
    }

    @PluginMethod
    public void layout(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopVlc();
        emit(true, false);
        call.resolve();
    }

    @PluginMethod
    public void getEngine(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("engine", "vlc");
        ret.put("isTv", true);
        call.resolve(ret);
    }

    private JSObject ok(boolean playing, boolean fs) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", playing);
        ret.put("fullscreen", fs);
        ret.put("engine", "vlc");
        return ret;
    }

    private void emit(boolean stopped, boolean fs) {
        JSObject ev = new JSObject();
        ev.put("stopped", stopped);
        ev.put("fullscreen", fs);
        ev.put("engine", "vlc");
        notifyListeners("nativePlayer", ev);
    }

    private void stopVlc() {
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            Intent i = new Intent(ctx.getPackageName() + ".STOP_VLC");
            i.setPackage(ctx.getPackageName());
            ctx.sendBroadcast(i);
        } catch (Throwable ignored) {}
    }

    private void lanzarVlc(Activity act, String url, String title) {
        Context ctx = getContext();
        if (ctx == null) throw new IllegalStateException("Sin contexto");
        Intent intent = new Intent();
        // setClassName evita cargar VlcPlayerActivity / LibVLC en este proceso.
        intent.setClassName(ctx.getPackageName(), ctx.getPackageName() + ".VlcPlayerActivity");
        intent.putExtra("url", url);
        intent.putExtra("title", title == null ? "" : title);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (act != null) {
            act.startActivity(intent);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        }
    }
}
