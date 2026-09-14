import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageDir = path.join(root, 'android/app/src/main/java/com/crewcheck/voyage');
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
const mainJavaPath = path.join(packageDir, 'MainActivity.java');
const mainKotlinPath = path.join(packageDir, 'MainActivity.kt');
const pluginJavaPath = path.join(packageDir, 'VoyagePdfSharePlugin.java');

let manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('android.intent.action.SEND')) {
  manifest = manifest.replace(
    /(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/,
    `$1\n            <intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="application/pdf" />\n            </intent-filter>`
  );
  await writeFile(manifestPath, manifest);
}

// Do not register ACTION_VIEW: Voyage must not become a catch-all viewer for arbitrary PDFs.
manifest = manifest.replace(/\s*<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>[\s\S]*?<data android:mimeType="application\/pdf" \/>\s*<\/intent-filter>/g, '');
await writeFile(manifestPath, manifest);

await mkdir(packageDir, { recursive: true });

await writeFile(pluginJavaPath, `package com.crewcheck.voyage;

import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "VoyagePdfShare")
public class VoyagePdfSharePlugin extends Plugin {
    private static final int MAX_BYTES = 15 * 1024 * 1024;

    @PluginMethod
    public void consumeSharedPdf(PluginCall call) {
        Intent intent = getActivity().getIntent();
        Uri uri = sharedUri(intent);
        if (uri == null) {
            JSObject result = new JSObject();
            result.put("available", false);
            call.resolve(result);
            return;
        }

        try (InputStream input = getActivity().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalArgumentException("pdf_unreadable");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (total > MAX_BYTES) throw new IllegalArgumentException("pdf_too_large");
                output.write(buffer, 0, read);
            }
            byte[] bytes = output.toByteArray();
            if (bytes.length < 5 || !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) {
                throw new IllegalArgumentException("invalid_pdf_signature");
            }

            JSObject result = new JSObject();
            result.put("available", true);
            result.put("name", displayName(uri));
            result.put("mimeType", "application/pdf");
            result.put("size", bytes.length);
            result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(result);

            // Consume once. Subsequent foreground checks must not re-import the same share intent.
            Intent consumed = new Intent(Intent.ACTION_MAIN);
            consumed.addCategory(Intent.CATEGORY_LAUNCHER);
            getActivity().setIntent(consumed);
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "pdf_share_failed");
        }
    }

    @SuppressWarnings("deprecation")
    private Uri sharedUri(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        Object value = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return value instanceof Uri ? (Uri) value : null;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getActivity().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isBlank()) return name;
            }
        } catch (Exception ignored) {}
        String fallback = uri.getLastPathSegment();
        return fallback == null || fallback.isBlank() ? "documento.pdf" : fallback;
    }
}
`);

const mainJava = `package com.crewcheck.voyage;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoyagePdfSharePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
`;

let hasJava = false;
let hasKotlin = false;
try { await access(mainJavaPath); hasJava = true; } catch {}
try { await access(mainKotlinPath); hasKotlin = true; } catch {}

if (hasKotlin && !hasJava) {
  throw new Error('Voyage PDF share expects the Capacitor Java template; MainActivity.kt was found without MainActivity.java. Convert the generated activity to Java or add Kotlin to Gradle explicitly.');
}

await writeFile(mainJavaPath, mainJava);
console.log('Voyage Android PDF SEND share target configured using Java.');
