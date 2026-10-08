const { withAppBuildGradle } = require("expo/config-plugins");

/*
 * WorkManager versiyalarini tenglashtirish (Android).
 * react-native-android-widget `work-runtime:2.8.1` ni, boshqa kutubxona esa tranzitiv
 * `work-runtime-ktx:2.7.1` ni olib keladi. 2.8 dan boshlab ktx klasslari work-runtime ichida —
 * eski ktx bilan «Duplicate class androidx.work.OneTimeWorkRequestKt» xatosi chiqadi.
 * Yechim: ikkala modul ham bir xil versiyada bo‘lsin (2.8 ktx — bo‘sh qobiq).
 */
const MARKER = "// staffora: workmanager-align";
const BLOCK = `
${MARKER}
configurations.all {
    resolutionStrategy {
        force "androidx.work:work-runtime:2.8.1"
        force "androidx.work:work-runtime-ktx:2.8.1"
    }
}
`;

module.exports = function withWorkManagerAlign(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += BLOCK;
    return cfg;
  });
};
