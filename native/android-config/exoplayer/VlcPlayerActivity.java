package PACKAGE_NAME;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.annotation.Nullable;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * Pantalla completa con LibVLC. En Google TV Streamer ExoPlayer congela el
 * vídeo (audio sigue); VLC usa otro camino de decodificación y suele aguantar.
 */
public class VlcPlayerActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    private static final String UA = "VLC/3.0.16 LibVLC/3.0.16";

    private static WeakReference<VlcPlayerActivity> viva;

    private LibVLC libVLC;
    private MediaPlayer mediaPlayer;
    private VLCVideoLayout vlcLayout;
    private TextView titleView;
    private boolean paused;

    public static boolean isRunning() {
        return viva != null && viva.get() != null;
    }

    public static void playNow(String url, String title) {
        VlcPlayerActivity a = viva == null ? null : viva.get();
        if (a == null) return;
        a.runOnUiThread(() -> a.playUrl(url, title));
    }

    public static void stopNow() {
        VlcPlayerActivity a = viva == null ? null : viva.get();
        if (a == null) return;
        a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        viva = new WeakReference<>(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_vlc);
        ocultarBarras();

        vlcLayout = findViewById(R.id.vlc_layout);
        titleView = findViewById(R.id.player_title);

        ArrayList<String> opts = VlcOptions.base();
        libVLC = new LibVLC(this, opts);
        mediaPlayer = new MediaPlayer(libVLC);
        if (vlcLayout != null) {
            vlcLayout.post(() -> {
                try {
                    if (mediaPlayer != null) mediaPlayer.attachViews(vlcLayout, null, false, false);
                } catch (Throwable e) {
                    try {
                        if (mediaPlayer != null) mediaPlayer.attachViews(vlcLayout, null, false, true);
                    } catch (Throwable ignored) {}
                }
                if (getIntent() != null) {
                    playUrl(getIntent().getStringExtra(EXTRA_URL), getIntent().getStringExtra(EXTRA_TITLE));
                }
            });
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) {
            playUrl(intent.getStringExtra(EXTRA_URL), intent.getStringExtra(EXTRA_TITLE));
        }
    }

    private void playUrl(String url, String title) {
        if (url == null || url.trim().isEmpty() || mediaPlayer == null || libVLC == null) return;
        if (titleView != null) {
            if (title != null && !title.trim().isEmpty()) {
                titleView.setText(title.trim());
                titleView.setVisibility(View.VISIBLE);
                titleView.postDelayed(() -> {
                    if (titleView != null) titleView.setVisibility(View.GONE);
                }, 3500);
            } else {
                titleView.setVisibility(View.GONE);
            }
        }
        try {
            Media media = new Media(libVLC, Uri.parse(url));
            media.setHWDecoderEnabled(true, false);
            media.addOption(":network-caching=2000");
            media.addOption(":live-caching=2000");
            media.addOption(":http-user-agent=" + UA);
            mediaPlayer.setMedia(media);
            media.release();
            paused = false;
            mediaPlayer.play();
        } catch (Throwable ignored) {
            return;
        }
        if (vlcLayout != null) {
            vlcLayout.post(() -> {
                try {
                    if (mediaPlayer != null) mediaPlayer.updateVideoSurfaces();
                } catch (Exception ignored) {}
            });
        }
    }

    private void ocultarBarras() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            return;
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int code = event.getKeyCode();
            if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
                finish();
                return true;
            }
            if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                || code == KeyEvent.KEYCODE_MEDIA_PLAY
                || code == KeyEvent.KEYCODE_MEDIA_PAUSE
                || code == KeyEvent.KEYCODE_DPAD_CENTER
                || code == KeyEvent.KEYCODE_ENTER) {
                if (mediaPlayer != null) {
                    if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                        mediaPlayer.pause();
                        paused = true;
                    } else if (code == KeyEvent.KEYCODE_MEDIA_PLAY) {
                        mediaPlayer.play();
                        paused = false;
                    } else if (paused || !mediaPlayer.isPlaying()) {
                        mediaPlayer.play();
                        paused = false;
                    } else {
                        mediaPlayer.pause();
                        paused = true;
                    }
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onStop() {
        if (mediaPlayer != null) mediaPlayer.pause();
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (mediaPlayer != null && !paused) mediaPlayer.play();
    }

    @Override
    protected void onDestroy() {
        if (viva != null && viva.get() == this) viva = null;
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            mediaPlayer.detachViews();
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (libVLC != null) {
            libVLC.release();
            libVLC = null;
        }
        super.onDestroy();
    }
}
