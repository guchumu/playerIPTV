package PACKAGE_NAME;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Dice a la web si este aparato es televisor (leanback) o móvil.
 *
 * El WebView de Android TV manda un User-Agent de Chrome de móvil, sin la
 * palabra "TV", así que core.js no puede adivinarlo. Aquí se mira
 * FEATURE_LEANBACK / UI_MODE_TYPE_TELEVISION y se inyecta
 * window.StreamBoxNative antes de que corra ningún script de la página.
 */
@CapacitorPlugin(name = "StreamBox")
public class StreamBoxPlugin extends Plugin {

    private static final String UA_MARCA = " StreamBoxTV/1.0 Leanback";

    static boolean esTelevisor(Context ctx) {
        if (ctx == null) return false;
        PackageManager pm = ctx.getPackageManager();
        if (pm != null) {
            if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true;
            if (pm.hasSystemFeature("android.software.leanback")) return true;
            if (pm.hasSystemFeature("android.software.leanback_only")) return true;
        }
        try {
            UiModeManager ui = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    static String scriptNativo(boolean isTv) {
        return "(function(){try{"
            + "window.StreamBoxNative={isTv:"
            + (isTv ? "true" : "false")
            + ",hasExo:true,exo:true};"
            + (isTv
                ? "document.documentElement.classList.add('is-native-tv');"
                    + "function a(){if(document.body)document.body.classList.add('is-tv');}"
                    + "a();"
                    + "if(!document.body)document.addEventListener('DOMContentLoaded',a);"
                : "document.documentElement.classList.remove('is-native-tv');")
            + "}catch(e){}})();";
    }

    @Override
    public void load() {
        Context ctx = getContext();
        boolean isTv = esTelevisor(ctx);
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        String js = scriptNativo(isTv);
        if (isTv) {
            String ua = webView.getSettings().getUserAgentString();
            if (ua != null && !ua.contains("StreamBoxTV")) {
                webView.getSettings().setUserAgentString(ua + UA_MARCA);
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            for (String origin : origenes(webView)) {
                try {
                    WebViewCompat.addDocumentStartJavaScript(webView, js, Collections.singleton(origin));
                } catch (Exception ignored) {}
            }
        }
    }

    private Set<String> origenes(WebView webView) {
        Set<String> out = new LinkedHashSet<>();
        out.add("https://acortador.vip");
        out.add("http://localhost");
        out.add("https://localhost");
        try {
            String loaded = webView.getUrl();
            if (loaded != null && loaded.startsWith("http")) {
                Uri u = Uri.parse(loaded);
                if (u.getScheme() != null && u.getHost() != null) {
                    out.add(u.getScheme() + "://" + u.getHost());
                }
            }
        } catch (Exception ignored) {}
        try {
            String server = getBridge().getServerUrl();
            if (server != null && server.startsWith("http")) {
                Uri u = Uri.parse(server);
                if (u.getScheme() != null && u.getHost() != null) {
                    out.add(u.getScheme() + "://" + u.getHost());
                }
            }
        } catch (Exception ignored) {}
        try {
            String app = getBridge().getAppUrl();
            if (app != null && app.startsWith("http")) {
                Uri u = Uri.parse(app);
                if (u.getScheme() != null && u.getHost() != null) {
                    out.add(u.getScheme() + "://" + u.getHost());
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        boolean isTv = esTelevisor(getContext());
        ret.put("isTv", isTv);
        ret.put("hasExo", true);
        ret.put("exo", true);
        call.resolve(ret);
    }
}
