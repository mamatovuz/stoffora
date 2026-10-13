// Panel mavzusi sahifa chizilishidan oldin qo‘yiladi (oq «chaqnash» bo‘lmasin).
// Mini App va ommaviy sahifalar o‘z mavzusida qoladi. CSP tufayli inline emas, alohida fayl.
(function () {
  try {
    if (/^\/(mini-app|id\/|attendance-screen)/.test(location.pathname)) return;
    var pref = localStorage.getItem("staffora-theme");
    var dark = pref ? pref === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (!dark) return;
    document.documentElement.dataset.theme = "dark";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#0e1217");
  } catch (e) {}
})();
