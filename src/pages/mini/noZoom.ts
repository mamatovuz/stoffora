/*
 * Mini App’da sahifani kattalashtirish (pinch-zoom) o‘chiriladi; ikki marta bosib
 * kattalashtirishni CSS (touch-action: manipulation) o‘chiradi — tugma bosilishlari yo‘qolmaydi.
 * Ilova native ilovadek turadi. Faqat Mini App ochiq paytda; panelga ta’sir qilmaydi.
 */
export function disableZoom() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const previous = meta?.content;
  if (meta) meta.content = "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover";

  // iOS Safari/WebView meta’ni e’tiborsiz qoldirishi mumkin — imo-ishoralarni ham to‘xtatamiz.
  const stopGesture = (event: Event) => event.preventDefault();
  const stopPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };
  const stopCtrlWheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };
  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("touchmove", stopPinch, { passive: false });
  window.addEventListener("wheel", stopCtrlWheel, { passive: false });
  document.documentElement.classList.add("mini-no-zoom");

  return () => {
    if (meta && previous !== undefined) meta.content = previous;
    document.removeEventListener("gesturestart", stopGesture);
    document.removeEventListener("gesturechange", stopGesture);
    document.removeEventListener("touchmove", stopPinch);
    window.removeEventListener("wheel", stopCtrlWheel);
    document.documentElement.classList.remove("mini-no-zoom");
  };
}
