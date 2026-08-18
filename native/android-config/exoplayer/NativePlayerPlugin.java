package PACKAGE_NAME;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.net.Uri;
import android.webkit.WebView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

/**
 * ExoPlayer encima del WebView.
 *
 * En TV la primera reproducción va en la ventana pequeña (rectángulo que
 * manda JS). OK otra vez (fullscreen=true) cubre toda la pantalla. Atrás
 * vuelve a la ventana. En el teléfono se abre a pantalla completa.
 *
 * Si no se puede incrustar, se cae a PlayerActivity como antes.
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private static final String UA = "VLC/3.0.16 LibVLC/3.0.16";

    private ExoPlayer player;
    private PlayerView playerView;
    private boolean fullscreen = false;
    private int boxX, boxY, boxW, boxH;
    private OnBackPressedCallback backCallback;

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL del canal");
            return;
        }
        String title = call.getString("title", "");
        String mime = call.getString("mime", "");
        boolean wantFs = Boolean.TRUE.equals(call.getBoolean("fullscreen", false));
        Activity act = getActivity();
        if (act == null) {
            call.reject("Sin actividad");
            return;
        }
        act.runOnUiThread(() -> {
            rememberBox(call);
            if (!ensureOverlay()) {
                lanzarActivity(url, title, mime);
                call.resolve(ok(true, wantFs));
                return;
            }
            playUrl(url, mime);
            applyLayout(wantFs);
            emit(false, wantFs);
            call.resolve(ok(true, wantFs));
        });
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean wantFs = Boolean.TRUE.equals(call.getBoolean("fullscreen", false));
        Activity act = getActivity();
        if (act == null) {
            call.resolve(ok(player != null, wantFs));
            return;
        }
        act.runOnUiThread(() -> {
            rememberBox(call);
            if (playerView == null) {
                call.resolve(ok(false, wantFs));
                return;
            }
            applyLayout(wantFs);
            emit(false, wantFs);
            call.resolve(ok(true, wantFs));
        });
    }

    @PluginMethod
    public void layout(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            rememberBox(call);
            if (playerView != null && !fullscreen) applyLayout(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            PlayerActivity.stopNow();
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            soltar();
            PlayerActivity.stopNow();
            emit(true, false);
            call.resolve();
        });
    }

    private JSObject ok(boolean playing, boolean fs) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", playing);
        ret.put("fullscreen", fs);
        return ret;
    }

    private void emit(boolean stopped, boolean fs) {
        JSObject ev = new JSObject();
        ev.put("stopped", stopped);
        ev.put("fullscreen", fs);
        notifyListeners("nativePlayer", ev);
    }

    private void rememberBox(PluginCall call) {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        ViewGroup parent = (ViewGroup) web.getParent();
        int[] loc = new int[2];
        int[] parentLoc = new int[2];
        web.getLocationInWindow(loc);
        if (parent != null) parent.getLocationInWindow(parentLoc);
        double vw = num(call, "vw", web.getWidth());
        double vh = num(call, "vh", web.getHeight());
        if (vw < 1) vw = Math.max(1, web.getWidth());
        if (vh < 1) vh = Math.max(1, web.getHeight());
        int mappedX = (int) Math.round(num(call, "left", 0) / vw * web.getWidth());
        int mappedY = (int) Math.round(num(call, "top", 0) / vh * web.getHeight());
        boxX = loc[0] - parentLoc[0] + mappedX;
        boxY = loc[1] - parentLoc[1] + mappedY;
        boxW = Math.max(120, (int) Math.round(num(call, "width", 320) / vw * web.getWidth()));
        boxH = Math.max(68, (int) Math.round(num(call, "height", 180) / vh * web.getHeight()));
    }

    private static double num(PluginCall call, String key, double fallback) {
        Double v = call.getDouble(key);
        return v == null ? fallback : v;
    }

    private boolean ensureOverlay() {
        Activity act = getActivity();
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (act == null || web == null) return false;
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent == null) return false;
        if (playerView != null && player != null) return true;

        playerView = (PlayerView) act.getLayoutInflater().inflate(R.layout.overlay_player, parent, false);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setUseController(false);
        playerView.setFocusable(false);
        playerView.setFocusableInTouchMode(false);

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(UA)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000);

        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
            .setTsExtractorFlags(
                DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                    | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
            );

        player = new ExoPlayer.Builder(act)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
            .build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                notifyListeners("nativePlayer", errorEvent(error));
            }
        });

        parent.addView(playerView, new FrameLayout.LayoutParams(boxW, boxH));
        playerView.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (!fullscreen) return false;
            if (keyCode != KeyEvent.KEYCODE_BACK && keyCode != KeyEvent.KEYCODE_ESCAPE) return false;
            applyLayout(false);
            emit(false, false);
            return true;
        });
        if (backCallback == null && act instanceof ComponentActivity) {
            backCallback = new OnBackPressedCallback(false) {
                @Override
                public void handleOnBackPressed() {
                    if (fullscreen && playerView != null) {
                        applyLayout(false);
                        emit(false, false);
                    }
                }
            };
            ((ComponentActivity) act).getOnBackPressedDispatcher().addCallback(act, backCallback);
        }
        return true;
    }

    private JSObject errorEvent(PlaybackException error) {
        JSObject ev = new JSObject();
        ev.put("stopped", false);
        ev.put("fullscreen", fullscreen);
        ev.put("error", error == null ? "error" : String.valueOf(error.getMessage()));
        return ev;
    }

    private void applyLayout(boolean fs) {
        if (playerView == null) return;
        fullscreen = fs;
        ViewGroup.LayoutParams raw = playerView.getLayoutParams();
        FrameLayout.LayoutParams lp = raw instanceof FrameLayout.LayoutParams
            ? (FrameLayout.LayoutParams) raw
            : new FrameLayout.LayoutParams(boxW, boxH);
        if (fs) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.leftMargin = 0;
            lp.topMargin = 0;
            playerView.setUseController(true);
            playerView.setFocusable(true);
            playerView.setFocusableInTouchMode(true);
            playerView.requestFocus();
        } else {
            lp.width = boxW;
            lp.height = boxH;
            lp.leftMargin = boxX;
            lp.topMargin = boxY;
            playerView.setUseController(false);
            playerView.setFocusable(false);
            playerView.clearFocus();
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) web.requestFocus();
        }
        playerView.setLayoutParams(lp);
        playerView.bringToFront();
        playerView.setVisibility(View.VISIBLE);
        if (backCallback != null) backCallback.setEnabled(fs);
    }

    private void playUrl(String url, String mime) {
        if (player == null || url == null) return;
        String tipo = mime == null ? "" : mime.trim();
        if (tipo.isEmpty()) {
            String lower = url.toLowerCase();
            if (lower.contains(".m3u8")) tipo = MimeTypes.APPLICATION_M3U8;
            else tipo = MimeTypes.VIDEO_MP2T;
        }
        MediaItem item = new MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMimeType(tipo)
            .build();
        player.setMediaItem(item);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private void lanzarActivity(String url, String title, String mime) {
        if (PlayerActivity.isRunning()) {
            PlayerActivity.playNow(url, title, mime);
            return;
        }
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, title == null ? "" : title);
        intent.putExtra(PlayerActivity.EXTRA_MIME, mime == null ? "" : mime);
        getActivity().startActivity(intent);
    }

    private void soltar() {
        fullscreen = false;
        if (playerView != null) {
            ViewGroup parent = (ViewGroup) playerView.getParent();
            if (parent != null) parent.removeView(playerView);
            playerView.setPlayer(null);
            playerView = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (backCallback != null) backCallback.setEnabled(false);
    }
}
