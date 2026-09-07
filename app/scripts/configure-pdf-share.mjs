import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
const mainActivityPath = path.join(root, 'android/app/src/main/java/com/crewcheck/voyage/MainActivity.kt');
const pluginPath = path.join(root, 'android/app/src/main/java/com/crewcheck/voyage/VoyagePdfSharePlugin.kt');

let manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('android.intent.action.SEND')) {
  manifest = manifest.replace(
    /(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/,
    `$1\n            <intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="application/pdf" />\n            </intent-filter>\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:mimeType="application/pdf" />\n            </intent-filter>`
  );
  await writeFile(manifestPath, manifest);
}

await mkdir(path.dirname(pluginPath), { recursive: true });
await writeFile(pluginPath, `package com.crewcheck.voyage

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "VoyagePdfShare")
class VoyagePdfSharePlugin : Plugin() {
    companion object {
        private const val MAX_BYTES = 15 * 1024 * 1024
    }

    @PluginMethod
    fun consumeSharedPdf(call: PluginCall) {
        val intent = activity.intent
        val uri = sharedUri(intent)
        if (uri == null) {
            call.resolve(JSObject().put("available", false))
            return
        }

        try {
            val resolver = activity.contentResolver
            val bytes = resolver.openInputStream(uri)?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > MAX_BYTES) throw IllegalArgumentException("pdf_too_large")
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            } ?: throw IllegalArgumentException("pdf_unreadable")

            if (bytes.size < 5 || String(bytes.copyOfRange(0, 5), Charsets.US_ASCII) != "%PDF-") {
                throw IllegalArgumentException("invalid_pdf_signature")
            }

            val result = JSObject()
            result.put("available", true)
            result.put("name", displayName(uri) ?: "documento.pdf")
            result.put("mimeType", "application/pdf")
            result.put("size", bytes.size)
            result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            call.resolve(result)

            // Consume once. Subsequent foreground checks must not re-import the same share intent.
            activity.intent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
        } catch (error: Exception) {
            call.reject(error.message ?: "pdf_share_failed")
        }
    }

    private fun sharedUri(intent: Intent?): Uri? {
        if (intent == null) return null
        return when (intent.action) {
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            Intent.ACTION_VIEW -> intent.data
            else -> null
        }
    }

    private fun displayName(uri: Uri): String? {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        return uri.lastPathSegment
    }
}
`);

let mainActivity = await readFile(mainActivityPath, 'utf8');
mainActivity = `package com.crewcheck.voyage

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VoyagePdfSharePlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}
`;
await writeFile(mainActivityPath, mainActivity);

console.log('Voyage Android PDF share target configured.');
