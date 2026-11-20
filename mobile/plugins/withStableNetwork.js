const fs = require("fs");
const path = require("path");
const { AndroidConfig, withDangerousMod, withMainApplication } = require("expo/config-plugins");

/*
 * Barqaror tarmoq (Android).
 * Ba’zi provayderlarda IPv6 yo‘li «o‘lik»: ulanish ~21 soniya osilib qoladi. Brauzer IPv4 va IPv6’ni
 * parallel sinaydi (Happy Eyeballs), RN’dagi OkHttp 4 esa yo‘q — manzillarni navbat bilan, ulanish
 * chegarasisiz (connectTimeout = 0) sinaydi. Natija: sayt ochiladi, ilova «server javob bermadi».
 * Yechim: IPv4 manzillar birinchi (IPv6 — zaxira, faqat-IPv6 tarmoqlar uchun), har bir manzilga
 * 6 soniya; javob bo‘lmasa OkHttp keyingi manzilga o‘tadi. Kuki va HTTP kesh — RN’dagidek.
 */
const CALL = "StafforaNetwork.install(this)";

const source = (pkg) => `package ${pkg}

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import okhttp3.Dns

/** Plagin yaratgan fayl (plugins/withStableNetwork.js) — qo‘lda tahrirlamang. */
object StafforaNetwork {
  private const val CONNECT_TIMEOUT_SECONDS = 6L

  /** IPv4 manzillar birinchi, IPv6 — keyin (faqat-IPv6 tarmoqda ham ishlaydi). */
  private val ipv4First = object : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      val all = Dns.SYSTEM.lookup(hostname)
      return all.filterIsInstance<Inet4Address>() + all.filterNot { it is Inet4Address }
    }
  }

  fun install(context: Context) {
    val app = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(app)
        .dns(ipv4First)
        .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()
    }
  }
}
`;

function withInstallCall(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== "kt") throw new Error("withStableNetwork: MainApplication.kt (Kotlin) kutilgan.");
    const contents = cfg.modResults.contents;
    if (contents.includes(CALL)) return cfg;
    const next = contents.replace(/^(\s*)super\.onCreate\(\)[^\n]*\n/m, (line, indent) => `${line}${indent}${CALL}\n`);
    if (next === contents) throw new Error("withStableNetwork: MainApplication.onCreate() ichida super.onCreate() topilmadi.");
    cfg.modResults.contents = next;
    return cfg;
  });
}

function withSourceFile(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error("withStableNetwork: app.json → android.package kerak.");
      const main = await AndroidConfig.Paths.getMainApplicationAsync(cfg.modRequest.projectRoot);
      fs.writeFileSync(path.join(path.dirname(main.path), "StafforaNetwork.kt"), source(pkg));
      return cfg;
    },
  ]);
}

module.exports = function withStableNetwork(config) {
  return withSourceFile(withInstallCall(config));
};
