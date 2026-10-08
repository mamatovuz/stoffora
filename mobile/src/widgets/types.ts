/** Bosh ekran vidjeti ma’lumoti (ilova har safar bosh sahifani yuklaganda yangilanadi). */
export type TodayProps = {
  /** Ma’lumot qaysi kun uchun (Toshkent, YYYY-MM-DD) — kun almashsa vidjet «Yangi kun» ko‘rsatadi. */
  date: string;
  status: string;
  checkIn: string;
  checkOut: string;
  /** Bugungi grafik, masalan «09:00–18:00». */
  shift: string;
  action: "in" | "out" | "none";
};
