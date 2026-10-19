package com.wizardchess.cathedral;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebResourceErrorCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** Hosts the bundled game in a WebView. Everything is served from the APK; there is no network permission. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String START_URL = ORIGIN + "/assets/index.html";
    private static final int BACKGROUND = Color.rgb(13, 11, 15);

    private FrameLayout root;
    private WebView webView;
    private Vibrator vibrator;
    private boolean foreground;
    private boolean sessionActive;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets cutout = insets.getInsets(WindowInsets.Type.displayCutout());
                view.setPadding(cutout.left, cutout.top, cutout.right, cutout.bottom);
                return insets;
            });
        } else if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
            getWindow().setAttributes(attributes);
        }
        createWebView();
        preferRefreshRate(true);
        immersive();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
        }
        root.removeAllViews();
        sessionActive = false;
        updateWakeState();
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setBuiltInZoomControls(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!trusted(request.getUrl())) return notFound();
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                return response == null ? notFound() : response;
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trusted(request.getUrl());
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceErrorCompat error) {
                if (request.isForMainFrame()) showError(getString(R.string.load_error));
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view);
                view.destroy();
                webView = null;
                sessionActive = false;
                updateWakeState();
                showError(getString(R.string.renderer_error));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }

            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG) android.util.Log.d("WizardChess", message.message());
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "WizardNative", Collections.singleton(ORIGIN),
                (view, message, sourceOrigin, isMainFrame, reply) -> {
                    if (isMainFrame && "https".equals(sourceOrigin.getScheme()) && HOST.equals(sourceOrigin.getHost())) handleMessage(message);
                });
        }
        webView.loadUrl(START_URL);
    }

    private boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
            new ByteArrayInputStream("Unavailable".getBytes(StandardCharsets.UTF_8)));
    }

    private void handleMessage(WebMessageCompat message) {
        try {
            String text = message.getData();
            if (text == null || text.length() > 2048) return;
            JSONObject request = new JSONObject(text);
            JSONObject data = request.optJSONObject("data");
            switch (request.optString("type", "")) {
                case "haptic":
                    if (foreground && data != null) vibrate(data.optJSONArray("pattern"));
                    break;
                case "session":
                    sessionActive = data != null && data.optBoolean("active", false);
                    updateWakeState();
                    break;
                case "display":
                    preferRefreshRate(data == null || data.optBoolean("highRefresh", true));
                    break;
                default:
                    break;
            }
        } catch (Exception ignored) {
            // Malformed messages from the page are dropped.
        }
    }

    private void vibrate(JSONArray pattern) {
        if (pattern == null || pattern.length() == 0 || vibrator == null || !vibrator.hasVibrator()) return;
        int count = Math.min(8, pattern.length());
        long[] timings = new long[count + 1];
        int[] amplitudes = new int[count + 1];
        for (int i = 0; i < count; i++) {
            timings[i + 1] = Math.max(0, Math.min(250, pattern.optLong(i, 0)));
            amplitudes[i + 1] = i % 2 == 0 ? VibrationEffect.DEFAULT_AMPLITUDE : 0;
        }
        vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
    }

    // Android keeps many 90/120 Hz panels at 60 Hz unless the app asks; the game can then render at
    // the panel's full rate. With high = false the mode closest to 60 Hz is chosen to save battery.
    @SuppressWarnings("deprecation")
    private void preferRefreshRate(boolean high) {
        Display display = Build.VERSION.SDK_INT >= 30 ? getDisplay() : getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode chosen = null;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() != current.getPhysicalWidth() || mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            if (chosen == null
                || (high && mode.getRefreshRate() > chosen.getRefreshRate())
                || (!high && Math.abs(mode.getRefreshRate() - 60f) < Math.abs(chosen.getRefreshRate() - 60f))) chosen = mode;
        }
        if (chosen == null) return;
        WindowManager.LayoutParams params = getWindow().getAttributes();
        if (params.preferredDisplayModeId != chosen.getModeId()) {
            params.preferredDisplayModeId = chosen.getModeId();
            getWindow().setAttributes(params);
        }
    }

    private void updateWakeState() {
        if (foreground && sessionActive) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void emit(String event) {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('wizard:" + event + "'));", null);
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            if (WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)) WebViewCompat.setAudioMuted(webView, false);
            emit("foreground");
        }
        updateWakeState();
        immersive();
    }

    @Override protected void onPause() {
        foreground = false;
        updateWakeState();
        if (vibrator != null) vibrator.cancel();
        if (webView != null) {
            emit("pause");
            if (WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)) WebViewCompat.setAudioMuted(webView, true);
            webView.onPause();
        }
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (vibrator != null) vibrator.cancel();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript("window.WizardAndroidBack ? window.WizardAndroidBack() : false", result -> {
            if ("true".equals(result) || isFinishing()) return;
            new AlertDialog.Builder(this)
                .setTitle(R.string.exit_title)
                .setMessage(R.string.exit_message)
                .setNegativeButton(R.string.exit_stay, (dialog, which) -> immersive())
                .setPositiveButton(R.string.exit_leave, (dialog, which) -> finish())
                .show();
        });
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private void showError(String text) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(48, 32, 48, 32);
        panel.setBackgroundColor(BACKGROUND);
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextColor(Color.rgb(236, 226, 204));
        label.setTextSize(18);
        label.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> createWebView());
        panel.addView(label);
        panel.addView(retry);
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }
}
