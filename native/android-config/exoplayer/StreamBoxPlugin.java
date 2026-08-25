package PACKAGE_NAME;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
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

    static String versionName(Context ctx) {
        if (ctx == null) return "";
        try {
            PackageInfo pi;
            if (Build.VERSION.SDK_INT >= 33) {
                pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), PackageManager.PackageInfoFlags.of(0));
            } else {
                pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            }
            return pi != null && pi.versionName != null ? pi.versionName : "";
        } catch (Exception e) {
            return "";
        }
    }

    static String scriptNativo(Context ctx, boolean isTv) {
        String engine = isTv ? "vlc" : "exo";
        String ver = versionName(ctx).replace("'", "").replace("\\", "");
        return "(function(){try{"
            + "window.StreamBoxNative=Object.assign({},window.StreamBoxNative||{},{isTv:"
            + (isTv ? "true" : "false")
            + ",hasExo:true,exo:true,hasVlc:true,engine:'"
            + engine
            + "',versionName:'"
            + ver
            + "'});"
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

        String js = scriptNativo(ctx, isTv);
        if (isTv) {
            String ua = webView.getSettings().getUserAgentString();
            if (ua != null && !ua.contains("StreamBoxTV")) {
                webView.getSettings().setUserAgentString(ua + UA_MARCA);
            }
        }

        boolean injected = false;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            for (String origin : origenes(webView)) {
                try {
                    WebViewCompat.addDocumentStartJavaScript(webView, js, Collections.singleton(origin));
                    injected = true;
                } catch (Exception ignored) {}
            }
        }
        // Por si DOCUMENT_START_SCRIPT no existe o falla: inyectar al cargar.
        final String jsFinal = js;
        webView.post(() -> {
            try {
                webView.evaluateJavascript(jsFinal, null);
            } catch (Exception ignored) {}
        });
        if (!injected) {
            // nada más: evaluateJavascript cubre el caso
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
        ret.put("hasVlc", true);
        ret.put("engine", isTv ? "vlc" : "exo");
        ret.put("versionName", versionName(getContext()));
        call.resolve(ret);
    }
}
