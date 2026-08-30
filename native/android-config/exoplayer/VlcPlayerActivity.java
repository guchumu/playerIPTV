package PACKAGE_NAME;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * Pantalla completa con LibVLC en un proceso aparte (:vlc).
 * Así un aborto nativo de VLC no tumba el menú del WebView.
 */
public class VlcPlayerActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    private static final String UA = "VLC/3.0.16 LibVLC/3.0.16";

    private LibVLC libVLC;
    private MediaPlayer mediaPlayer;
    private VLCVideoLayout vlcLayout;
    private TextView titleView;
    private boolean paused;
    private boolean receiverOn;
    private String stopAction;
    private String boostAction;

    private final BroadcastReceiver stopReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && boostAction != null && boostAction.equals(intent.getAction())) {
                float boost = intent.getFloatExtra("audioBoost", AudioBoost.last);
                AudioBoost.last = AudioBoost.clamp(boost);
                aplicarVolumen();
                return;
            }
            finish();
        }
    };

    public static void stopNow(Context ctx) {
        if (ctx == null) return;
        try {
            Intent i = new Intent(ctx.getPackageName() + ".STOP_VLC");
            i.setPackage(ctx.getPackageName());
            ctx.sendBroadcast(i);
        } catch (Throwable ignored) {}
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        stopAction = getPackageName() + ".STOP_VLC";
        boostAction = getPackageName() + ".AUDIO_BOOST";
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (stopAction.equals(getIntent() != null ? getIntent().getAction() : null)) {
            finish();
            return;
        }
        registrarStop();
        try {
            setContentView(R.layout.activity_vlc);
        } catch (Throwable t) {
            finish();
            return;
        }
        ocultarBarras();

        vlcLayout = findViewById(R.id.vlc_layout);
        titleView = findViewById(R.id.player_title);

        try {
            libVLC = new LibVLC(this, VlcOptions.base());
            mediaPlayer = new MediaPlayer(libVLC);
        } catch (Throwable t) {
            finish();
            return;
        }
        if (vlcLayout != null) {
            vlcLayout.post(() -> attachWhenReady(0));
        }
    }

    private void registrarStop() {
        if (receiverOn) return;
        if (stopAction == null) stopAction = getPackageName() + ".STOP_VLC";
        if (boostAction == null) boostAction = getPackageName() + ".AUDIO_BOOST";
        IntentFilter filter = new IntentFilter();
        filter.addAction(stopAction);
        filter.addAction(boostAction);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(stopReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(stopReceiver, filter);
            }
            receiverOn = true;
        } catch (Throwable ignored) {}
    }

    private void attachWhenReady(int tries) {
        if (isFinishing() || mediaPlayer == null || vlcLayout == null) return;
        if (vlcLayout.getWidth() < 2 || vlcLayout.getHeight() < 2) {
            if (tries > 40) {
                finish();
                return;
            }
            vlcLayout.postDelayed(() -> attachWhenReady(tries + 1), 32);
            return;
        }
        try {
            mediaPlayer.attachViews(vlcLayout, null, false, false);
        } catch (Throwable e) {
            try {
                mediaPlayer.attachViews(vlcLayout, null, false, true);
            } catch (Throwable ignored) {
                finish();
                return;
            }
        }
        if (getIntent() != null) {
            leerBoost(getIntent());
            playUrl(getIntent().getStringExtra(EXTRA_URL), getIntent().getStringExtra(EXTRA_TITLE));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && stopAction != null && stopAction.equals(intent.getAction())) {
            finish();
            return;
        }
        if (intent != null) {
            leerBoost(intent);
            playUrl(intent.getStringExtra(EXTRA_URL), intent.getStringExtra(EXTRA_TITLE));
        }
    }

    private void leerBoost(Intent intent) {
        if (intent == null) return;
        if (!intent.hasExtra("audioBoost")) return;
        AudioBoost.last = AudioBoost.clamp(intent.getFloatExtra("audioBoost", AudioBoost.last));
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
            media.addOption(":gain=" + AudioBoost.clamp(AudioBoost.last));
            mediaPlayer.setMedia(media);
            media.release();
            paused = false;
            try {
                mediaPlayer.setScale(0);
                mediaPlayer.setAspectRatio(null);
            } catch (Throwable ignored) {}
            mediaPlayer.play();
            aplicarVolumen();
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

    private void aplicarVolumen() {
        if (mediaPlayer == null) return;
        try {
            mediaPlayer.setVolume(AudioBoost.vlcPercent(AudioBoost.last));
        } catch (Throwable ignored) {}
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
                || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
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
            // OK/Enter no pausan: en TV el usuario espera que el vídeo siga.
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onStop() {
        if (mediaPlayer != null) {
            try {
                mediaPlayer.pause();
            } catch (Throwable ignored) {}
        }
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (mediaPlayer != null && !paused) {
            try {
                mediaPlayer.play();
            } catch (Throwable ignored) {}
        }
    }

    @Override
    protected void onDestroy() {
        if (receiverOn) {
            try {
                unregisterReceiver(stopReceiver);
            } catch (Throwable ignored) {}
            receiverOn = false;
        }
        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.detachViews();
            } catch (Throwable ignored) {}
            try {
                mediaPlayer.release();
            } catch (Throwable ignored) {}
            mediaPlayer = null;
        }
        if (libVLC != null) {
            try {
                libVLC.release();
            } catch (Throwable ignored) {}
            libVLC = null;
        }
        try {
            Intent done = new Intent(getPackageName() + ".VLC_FINISHED");
            done.setPackage(getPackageName());
            sendBroadcast(done);
        } catch (Throwable ignored) {}
        super.onDestroy();
    }
}
