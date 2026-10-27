package com.amoolink.notes

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Random
import java.util.regex.Pattern

/**
 * AmooNotes(M6):WebView 壳承载 Tiptap 编辑器离线 bundle;
 * Kotlin 只负责 .md 文件读写(assets/editor 内 JS 完成 frontmatter 序列化)与
 * FileObserver 外部变更(桌面端 ADB 同步写入)感知。
 * 目录:getExternalFilesDir/notes —— app 免权限读写,adb 可直连,即同步通道(docs/08 §3.3)。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var notesDir: File
    private lateinit var titleView: TextView

    private var currentId = ""
    private var lastSelfWriteAt = 0L
    private var observer: FileObserver? = null
    private val ui = Handler(Looper.getMainLooper())

    private val idPattern = Pattern.compile("^[0-9]{8}-[0-9]{6}-[a-z0-9]{5}$")
    private val titlePattern = Pattern.compile("^title:(.*)$", Pattern.MULTILINE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        notesDir = File(getExternalFilesDir(null), "notes").apply { mkdirs() }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(26), dp(10), dp(6))
            gravity = Gravity.CENTER_VERTICAL
        }
        val listBtn = Button(this).apply {
            text = "列表"
            isAllCaps = false
            textSize = 14f
            minHeight = 0
            minimumWidth = 0
            setPadding(dp(14), dp(6), dp(14), dp(6))
        }
        titleView = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 17f
            isSingleLine = true
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(8), 0, dp(8), 0)
        }
        val newBtn = Button(this).apply {
            text = "新建"
            isAllCaps = false
            textSize = 14f
            minHeight = 0
            minimumWidth = 0
            setPadding(dp(14), dp(6), dp(14), dp(6))
        }
        bar.addView(listBtn)
        bar.addView(
            titleView,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        bar.addView(newBtn)
        web = WebView(this)
        root.addView(bar)
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        listBtn.setOnClickListener { showNoteList() }
        newBtn.setOnClickListener { createAndOpen() }

        setupWebView()
        startObserver()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "AmooNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                // ready 由 JS 主动回调(index.html),此处兜底:1.5s 后仍未打开则取最新
                ui.postDelayed({ if (currentId.isEmpty()) openLatest() }, 1500)
            }
        }
        web.loadUrl("file:///android_asset/index.html")
    }

    private fun startObserver() {
        val mask = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.DELETE
        observer = object : FileObserver(notesDir.absolutePath, mask) {
            override fun onEvent(event: Int, path: String?) {
                if (path == null || !path.endsWith(".md")) return
                ui.post { onExternalChange(path) }
            }
        }
        observer?.startWatching()
    }

    /** 桌面端同步写入当前笔记 → 热替换编辑器内容(1.5s 内的自身写入除外)。 */
    private fun onExternalChange(name: String) {
        val id = name.removeSuffix(".md")
        if (id != currentId) return
        if (System.currentTimeMillis() - lastSelfWriteAt < 1500) return
        val raw = readNoteFile(id) ?: return
        switchTo(id, raw)
        Toast.makeText(this, "笔记已从电脑同步更新", Toast.LENGTH_SHORT).show()
    }

    // ── 笔记操作 ──────────────────────────────────────────

    private fun readNoteFile(id: String): String? = try {
        File(notesDir, "$id.md").readText()
    } catch (_: Exception) {
        null
    }

    private fun writeNoteFile(id: String, raw: String): Boolean {
        val tmp = File(notesDir, "$id.md.tmp")
        val target = File(notesDir, "$id.md")
        return try {
            tmp.writeText(raw)
            if (target.exists()) target.delete()
            val ok = tmp.renameTo(target)
            if (ok) lastSelfWriteAt = System.currentTimeMillis()
            ok
        } catch (_: Exception) {
            false
        }
    }

    private fun openLatest() {
        val latest = listNoteFiles().firstOrNull()
        if (latest == null) createAndOpen() else switchTo(latest.nameWithoutExtension, readNoteFile(latest.nameWithoutExtension) ?: "")
    }

    private fun switchTo(id: String, raw: String) {
        currentId = id
        val payload = JSONObject().put("id", id).put("raw", raw)
        web.evaluateJavascript("window.__switch(${JSONObject.quote(payload.toString())})", null)
    }

    private fun createAndOpen() {
        val id = makeId()
        switchTo(id, "")
        // 立即落一个空笔记文件(frontmatter 由 JS serialize 生成)
        web.evaluateJavascript("window.__flushNow()", null)
        Toast.makeText(this, "已新建笔记", Toast.LENGTH_SHORT).show()
    }

    private fun listNoteFiles(): List<File> =
        notesDir.listFiles { f -> f.name.endsWith(".md") }?.sortedByDescending { it.lastModified() } ?: emptyList()

    private fun noteTitle(id: String): String {
        val raw = readNoteFile(id) ?: return id
        val m = titlePattern.matcher(raw.take(512))
        return if (m.find()) m.group(1)?.trim()?.ifEmpty { id } ?: id else id
    }

    private fun showNoteList() {
        val files = listNoteFiles()
        val ids = files.map { it.nameWithoutExtension }
        val titles = ids.map { noteTitle(it) }
        val adapter = android.widget.ArrayAdapter(
            this,
            android.R.layout.simple_list_item_1,
            titles.map { t -> if (t.length > 28) t.take(28) + "…" else t }.toTypedArray(),
        )
        val dialog = AlertDialog.Builder(this)
            .setTitle("我的笔记(${ids.size})")
            .setAdapter(adapter) { d, which ->
                val id = ids[which]
                switchTo(id, readNoteFile(id) ?: "")
                d.dismiss()
            }
            .setNegativeButton("关闭", null)
            .create()
        dialog.listView.onItemLongClickListener = android.widget.AdapterView.OnItemLongClickListener { _, _, which, _ ->
            val id = ids[which]
            AlertDialog.Builder(this)
                .setTitle("删除笔记?")
                .setMessage(titles[which])
                .setPositiveButton("删除") { d, _ ->
                    File(notesDir, "$id.md").delete()
                    Toast.makeText(this, "已删除(连接电脑后同步)", Toast.LENGTH_SHORT).show()
                    if (id == currentId) openLatest()
                    d.dismiss()
                }
                .setNegativeButton("取消", null)
                .show()
            dialog.dismiss()
            true
        }
        dialog.show()
    }

    private fun makeId(): String {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        val rand = buildString { repeat(5) { append(chars[Random().nextInt(chars.length)]) } }
        return "$stamp-$rand"
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    // ── JS 桥(JS 线程调用,文件 IO 直接执行)────────────────

    inner class Bridge {
        @JavascriptInterface
        fun writeNote(id: String, raw: String): Boolean {
            if (!idPattern.matcher(id).matches()) return false
            return writeNoteFile(id, raw)
        }

        @JavascriptInterface
        fun readNote(id: String): String = readNoteFile(id) ?: ""

        @JavascriptInterface
        fun listNotes(): String {
            val arr = JSONArray()
            for (f in listNoteFiles()) {
                arr.put(
                    JSONObject()
                        .put("id", f.nameWithoutExtension)
                        .put("title", noteTitle(f.nameWithoutExtension))
                        .put("lastModified", f.lastModified()),
                )
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun deleteNote(id: String): Boolean {
            if (!idPattern.matcher(id).matches()) return false
            val ok = File(notesDir, "$id.md").delete()
            if (ok && id == currentId) ui.post { openLatest() }
            return ok
        }

        @JavascriptInterface
        fun setTitle(title: String) {
            ui.post { titleView.text = title }
        }

        @JavascriptInterface
        fun ready() {
            ui.post { if (currentId.isEmpty()) openLatest() }
        }

        @JavascriptInterface
        fun log(message: String) {
            android.util.Log.d("AmooNotes", message)
        }
    }
}
