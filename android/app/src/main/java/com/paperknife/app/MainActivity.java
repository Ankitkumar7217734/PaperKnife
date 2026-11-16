package com.paperknife.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {
    private static final int MAX_WEBVIEW_RETRIES = 20;
    private final ExecutorService intentExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    // BridgeActivity declares onDestroy() as public; overrides cannot narrow visibility.
    @Override
    public void onDestroy() {
        intentExecutor.shutdownNow();
        super.onDestroy();
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_VIEW.equals(action)) return;

        Uri sourceUri = Intent.ACTION_SEND.equals(action)
            ? getSharedStream(intent)
            : intent.getData();
        if (sourceUri == null) return;

        String displayName = getDisplayName(sourceUri);
        String mimeType = intent.getType();
        if (mimeType == null) mimeType = getContentResolver().getType(sourceUri);
        String lowerName = displayName.toLowerCase(Locale.ROOT);
        boolean isPdf = "application/pdf".equalsIgnoreCase(mimeType)
            || "application/x-pdf".equalsIgnoreCase(mimeType)
            || lowerName.endsWith(".pdf");
        boolean isImage = (mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("image/"))
            || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
            || lowerName.endsWith(".png") || lowerName.endsWith(".webp")
            || lowerName.endsWith(".gif") || lowerName.endsWith(".heic")
            || lowerName.endsWith(".heif") || lowerName.endsWith(".tif")
            || lowerName.endsWith(".tiff") || lowerName.endsWith(".bmp")
            || lowerName.endsWith(".avif");
        if (!isPdf && !isImage) return;

        // Consume the Intent before background I/O so onResume cannot import it twice.
        intent.setAction(null);
        intent.removeExtra(Intent.EXTRA_STREAM);

        // Keep the shared file's identity intact so the WebView can derive its type.
        String fallbackExtension = isImage ? ".jpg" : ".pdf";
        final String finalDisplayName = hasFileExtension(lowerName) ? displayName : displayName + fallbackExtension;
        intentExecutor.execute(() -> {
            File cachedFile = null;
            try {
                cachedFile = copyToPrivateCache(sourceUri, finalDisplayName);
                dispatchFileIntent(cachedFile.getAbsolutePath(), finalDisplayName, 0);
            } catch (Exception error) {
                if (cachedFile != null) cachedFile.delete();
                android.util.Log.e("PaperKnife", "Unable to import shared file", error);
            }
        });
    }

    private boolean hasFileExtension(String lowerName) {
        int dot = lowerName.lastIndexOf('.');
        if (dot <= 0 || dot == lowerName.length() - 1) return false;
        // Reject names whose "extension" is not a short alphanumeric suffix (e.g. "my.photo").
        String ext = lowerName.substring(dot + 1);
        if (ext.length() > 5) return false;
        for (int i = 0; i < ext.length(); i++) {
            char c = ext.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
            if (!ok) return false;
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private Uri getSharedStream(Intent intent) {
        return (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    private String getDisplayName(Uri uri) {
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        String name = cursor.getString(nameIndex);
                        if (name != null && !name.trim().isEmpty()) return name;
                    }
                }
            } catch (Exception error) {
                android.util.Log.w("PaperKnife", "Could not read shared filename", error);
            }
        }

        String lastSegment = uri.getLastPathSegment();
        return lastSegment == null || lastSegment.trim().isEmpty() ? "imported-file" : lastSegment;
    }

    private File copyToPrivateCache(Uri sourceUri, String displayName) throws IOException {
        File importDirectory = new File(getCacheDir(), "imports");
        if (!importDirectory.exists() && !importDirectory.mkdirs()) {
            throw new IOException("Could not create the import cache directory.");
        }

        String lowerName = displayName.toLowerCase(Locale.ROOT);
        int dot = lowerName.lastIndexOf('.');
        String suffix = dot > 0 && dot < lowerName.length() - 1 && lowerName.length() - dot <= 6
            ? lowerName.substring(dot)  // keep the shared file's extension (e.g. ".jpg")
            : ".bin";
        File target = File.createTempFile("paperknife-import-", suffix, importDirectory);
        try (InputStream input = getContentResolver().openInputStream(sourceUri);
             OutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IOException("The selected file could not be opened.");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        } catch (IOException error) {
            target.delete();
            throw error;
        } catch (RuntimeException error) {
            target.delete();
            throw error;
        }
        return target;
    }

    private void dispatchFileIntent(String path, String displayName, int attempt) {
        new Handler(Looper.getMainLooper()).post(() -> {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            String currentUrl = webView == null ? null : webView.getUrl();
            if (webView == null || currentUrl == null || "about:blank".equals(currentUrl)) {
                if (attempt < MAX_WEBVIEW_RETRIES) {
                    new Handler(Looper.getMainLooper()).postDelayed(
                        () -> dispatchFileIntent(path, displayName, attempt + 1),
                        100
                    );
                }
                return;
            }

            String detailJson = "{\"uri\":" + JSONObject.quote(path)
                + ",\"name\":" + JSONObject.quote(displayName)
                + ",\"temporary\":true}";
            String script = "(function(){var detail=" + detailJson
                + ";window.__paperknifePendingFileIntent=detail;"
                + "window.dispatchEvent(new CustomEvent('fileIntent',{detail:detail}));})();";

            // The global pending value keeps cold-start Intents alive until React mounts.
            webView.post(() -> webView.evaluateJavascript(script, null));
        });
    }
}
