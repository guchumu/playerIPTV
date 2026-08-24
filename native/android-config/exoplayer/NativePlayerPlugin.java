package PACKAGE_NAME;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
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
import java.util.ArrayList;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * Reproductor nativo encima del WebView.
 *
 * En TV (Google Streamer, Fire Stick, etc.) usa LibVLC: ExoPlayer/Media3
 * congela el vídeo en el decoder MediaTek y el audio sigue. En móvil sigue
 * ExoPlayer, que ahí va bien.
 *
 * En TV la primera reproducción va en la ventana pequeña. OK otra vez
 * (fullscreen=true) cubre toda la pantalla. Atrás vuelve a la ventana.
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private static final String UA = "VLC/3.0.16 LibVLC/3.0.16";

    private ExoPlayer exoPlayer;
    private PlayerView exoView;

    private LibVLC libVLC;
    private MediaPlayer vlcPlayer;
    private View vlcRoot;
    private VLCVideoLayout vlcLayout;

    private View overlay;
    private boolean useVlc;
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
            useVlc = StreamBoxPlugin.esTelevisor(act);
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
            call.resolve(ok(overlay != null, wantFs));
            return;
        }
        act.runOnUiThread(() -> {
            rememberBox(call);
            if (overlay == null) {
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
            if (overlay != null && !fullscreen) applyLayout(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            PlayerActivity.stopNow();
            VlcPlayerActivity.stopNow();
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            soltar();
            PlayerActivity.stopNow();
            VlcPlayerActivity.stopNow();
            emit(true, false);
            call.resolve();
        });
    }

    @PluginMethod
    public void getEngine(PluginCall call) {
        JSObject ret = new JSObject();
        boolean tv = StreamBoxPlugin.esTelevisor(getContext());
        ret.put("engine", tv ? "vlc" : "exo");
        ret.put("isTv", tv);
        call.resolve(ret);
    }

    private JSObject ok(boolean playing, boolean fs) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", playing);
        ret.put("fullscreen", fs);
        ret.put("engine", useVlc ? "vlc" : "exo");
        return ret;
    }

    private void emit(boolean stopped, boolean fs) {
        JSObject ev = new JSObject();
        ev.put("stopped", stopped);
        ev.put("fullscreen", fs);
        ev.put("engine", useVlc ? "vlc" : "exo");
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

        if (overlay != null) {
            if (useVlc && vlcPlayer != null) return true;
            if (!useVlc && exoPlayer != null) return true;
            soltar();
        }

        if (useVlc) {
            return ensureVlc(act, parent);
        }
        return ensureExo(act, parent);
    }

    private boolean ensureVlc(Activity act, ViewGroup parent) {
        vlcRoot = act.getLayoutInflater().inflate(R.layout.overlay_vlc, parent, false);
        vlcRoot.setBackgroundColor(Color.BLACK);
        vlcRoot.setFocusable(false);
        vlcRoot.setFocusableInTouchMode(false);
        vlcLayout = vlcRoot.findViewById(R.id.overlay_vlc_layout);

        ArrayList<String> opts = VlcOptions.base();
        libVLC = new LibVLC(act, opts);
        vlcPlayer = new MediaPlayer(libVLC);
        vlcPlayer.attachViews(vlcLayout, null, false, false);

        overlay = vlcRoot;
        parent.addView(overlay, new FrameLayout.LayoutParams(boxW, boxH));
        wireOverlayKeys();
        wireBackCallback(act);
        return true;
    }

    private boolean ensureExo(Activity act, ViewGroup parent) {
        exoView = (PlayerView) act.getLayoutInflater().inflate(R.layout.overlay_player, parent, false);
        exoView.setBackgroundColor(Color.BLACK);
        exoView.setUseController(false);
        exoView.setFocusable(false);
        exoView.setFocusableInTouchMode(false);

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

        exoPlayer = new ExoPlayer.Builder(act)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
            .build();
        exoView.setPlayer(exoPlayer);
        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                notifyListeners("nativePlayer", errorEvent(error));
            }
        });

        overlay = exoView;
        parent.addView(overlay, new FrameLayout.LayoutParams(boxW, boxH));
        wireOverlayKeys();
        wireBackCallback(act);
        return true;
    }

    private void wireOverlayKeys() {
        if (overlay == null) return;
        overlay.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (!fullscreen) return false;
            if (keyCode != KeyEvent.KEYCODE_BACK && keyCode != KeyEvent.KEYCODE_ESCAPE) return false;
            applyLayout(false);
            emit(false, false);
            return true;
        });
    }

    private void wireBackCallback(Activity act) {
        if (backCallback == null && act instanceof ComponentActivity) {
            backCallback = new OnBackPressedCallback(false) {
                @Override
                public void handleOnBackPressed() {
                    if (fullscreen && overlay != null) {
                        applyLayout(false);
                        emit(false, false);
                    }
                }
            };
            ((ComponentActivity) act).getOnBackPressedDispatcher().addCallback(act, backCallback);
        }
    }

    private JSObject errorEvent(PlaybackException error) {
        JSObject ev = new JSObject();
        ev.put("stopped", false);
        ev.put("fullscreen", fullscreen);
        ev.put("engine", useVlc ? "vlc" : "exo");
        ev.put("error", error == null ? "error" : String.valueOf(error.getMessage()));
        return ev;
    }

    private void applyLayout(boolean fs) {
        if (overlay == null) return;
        fullscreen = fs;
        ViewGroup.LayoutParams raw = overlay.getLayoutParams();
        FrameLayout.LayoutParams lp = raw instanceof FrameLayout.LayoutParams
            ? (FrameLayout.LayoutParams) raw
            : new FrameLayout.LayoutParams(boxW, boxH);
        if (fs) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.leftMargin = 0;
            lp.topMargin = 0;
            if (exoView != null) {
                exoView.setUseController(true);
                exoView.setFocusable(true);
                exoView.setFocusableInTouchMode(true);
                exoView.requestFocus();
            } else {
                overlay.setFocusable(true);
                overlay.setFocusableInTouchMode(true);
                overlay.requestFocus();
            }
        } else {
            lp.width = boxW;
            lp.height = boxH;
            lp.leftMargin = boxX;
            lp.topMargin = boxY;
            if (exoView != null) {
                exoView.setUseController(false);
                exoView.setFocusable(false);
                exoView.clearFocus();
            } else {
                overlay.setFocusable(false);
                overlay.clearFocus();
            }
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) web.requestFocus();
        }
        overlay.setLayoutParams(lp);
        overlay.bringToFront();
        overlay.setVisibility(View.VISIBLE);
        if (backCallback != null) backCallback.setEnabled(fs);
    }

    private void playUrl(String url, String mime) {
        if (url == null) return;
        if (useVlc) {
            playVlc(url);
            return;
        }
        playExo(url, mime);
    }

    private void playVlc(String url) {
        if (vlcPlayer == null || libVLC == null) return;
        Media media = new Media(libVLC, Uri.parse(url));
        media.setHWDecoderEnabled(true, false);
        media.addOption(":network-caching=2000");
        media.addOption(":live-caching=2000");
        media.addOption(":http-user-agent=" + UA);
        vlcPlayer.setMedia(media);
        media.release();
        vlcPlayer.play();
    }

    private void playExo(String url, String mime) {
        if (exoPlayer == null) return;
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
        exoPlayer.setMediaItem(item);
        exoPlayer.prepare();
        exoPlayer.setPlayWhenReady(true);
    }

    private void lanzarActivity(String url, String title, String mime) {
        Activity act = getActivity();
        boolean tv = act != null && StreamBoxPlugin.esTelevisor(act);
        if (tv) {
            if (VlcPlayerActivity.isRunning()) {
                VlcPlayerActivity.playNow(url, title);
                return;
            }
            Intent intent = new Intent(getContext(), VlcPlayerActivity.class);
            intent.putExtra(VlcPlayerActivity.EXTRA_URL, url);
            intent.putExtra(VlcPlayerActivity.EXTRA_TITLE, title == null ? "" : title);
            getActivity().startActivity(intent);
            return;
        }
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
        if (overlay != null) {
            ViewGroup parent = (ViewGroup) overlay.getParent();
            if (parent != null) parent.removeView(overlay);
            overlay = null;
        }
        if (exoView != null) {
            exoView.setPlayer(null);
            exoView = null;
        }
        if (exoPlayer != null) {
            exoPlayer.release();
            exoPlayer = null;
        }
        if (vlcPlayer != null) {
            try {
                vlcPlayer.stop();
                vlcPlayer.detachViews();
            } catch (Exception ignored) {}
            vlcPlayer.release();
            vlcPlayer = null;
        }
        vlcLayout = null;
        vlcRoot = null;
        if (libVLC != null) {
            libVLC.release();
            libVLC = null;
        }
        if (backCallback != null) backCallback.setEnabled(false);
    }
}
