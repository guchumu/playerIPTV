package PACKAGE_NAME;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente JS → ExoPlayer. La web llama a Capacitor.Plugins.NativePlayer.play
 * cuando corre dentro de la app; el navegador no tiene este plugin y sigue
 * con mpegts.js / hls.js.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL del canal");
            return;
        }
        String title = call.getString("title", "");
        String mime = call.getString("mime", "");
        if (PlayerActivity.isRunning()) {
            PlayerActivity.playNow(url, title, mime);
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, title == null ? "" : title);
        intent.putExtra(PlayerActivity.EXTRA_MIME, mime == null ? "" : mime);
        getActivity().startActivity(intent);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlayerActivity.stopNow();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
