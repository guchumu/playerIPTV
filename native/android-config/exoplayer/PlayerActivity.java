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
import java.lang.ref.WeakReference;

/**
 * Reproductor a pantalla completa con Media3/ExoPlayer.
 *
 * En TV corre en el proceso :exo para no cargar Media3 junto al WebView
 * (en Google Streamer eso abortaba el menú).
 */
@UnstableApi
public class PlayerActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_MIME = "mime";

    private static final String UA = "VLC/3.0.16 LibVLC/3.0.16";

    private static WeakReference<PlayerActivity> viva;

    private ExoPlayer player;
    private PlayerView playerView;
    private TextView titleView;
    private String stopAction;
    private boolean receiverOn;

    private final BroadcastReceiver stopReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    public static boolean isRunning() {
        return viva != null && viva.get() != null;
    }

    public static void playNow(String url, String title, String mime) {
        PlayerActivity a = viva == null ? null : viva.get();
        if (a == null) return;
        a.runOnUiThread(() -> a.playUrl(url, title, mime));
    }

    public static void stopNow() {
        PlayerActivity a = viva == null ? null : viva.get();
        if (a == null) return;
        a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        viva = new WeakReference<>(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_player);
        ocultarBarras();

        stopAction = getPackageName() + ".STOP_EXO";
        try {
            IntentFilter filter = new IntentFilter(stopAction);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(stopReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(stopReceiver, filter);
            }
            receiverOn = true;
        } catch (Throwable ignored) {}

        playerView = findViewById(R.id.player_view);
        titleView = findViewById(R.id.player_title);

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

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
            .build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                if (titleView == null) return;
                titleView.setVisibility(View.VISIBLE);
                titleView.setText("No se pudo reproducir el canal");
                titleView.postDelayed(() -> {
                    if (!isFinishing()) finish();
                }, 2800);
            }
        });

        if (getIntent() != null) {
            playUrl(
                getIntent().getStringExtra(EXTRA_URL),
                getIntent().getStringExtra(EXTRA_TITLE),
                getIntent().getStringExtra(EXTRA_MIME)
            );
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
            playUrl(
                intent.getStringExtra(EXTRA_URL),
                intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_MIME)
            );
        }
    }

    private void playUrl(String url, String title, String mime) {
        if (url == null || url.trim().isEmpty() || player == null) return;
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
                if (player != null) {
                    if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) player.pause();
                    else if (code == KeyEvent.KEYCODE_MEDIA_PLAY) player.play();
                    else if (player.isPlaying()) player.pause();
                    else player.play();
                }
                if (playerView != null) playerView.showController();
                return true;
            }
        }
        if (playerView != null && playerView.dispatchKeyEvent(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onStop() {
        if (player != null) player.setPlayWhenReady(false);
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (player != null) player.setPlayWhenReady(true);
    }

    @Override
    protected void onDestroy() {
        if (receiverOn) {
            try {
                unregisterReceiver(stopReceiver);
            } catch (Throwable ignored) {}
            receiverOn = false;
        }
        if (viva != null && viva.get() == this) viva = null;
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) {
            player.release();
            player = null;
        }
        try {
            Intent done = new Intent(getPackageName() + ".EXO_FINISHED");
            done.setPackage(getPackageName());
            sendBroadcast(done);
        } catch (Throwable ignored) {}
        super.onDestroy();
    }
}
