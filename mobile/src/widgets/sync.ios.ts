import type { HomeData } from "@/lib/types";
import TodayWidget from "./TodayWidget.ios";
import { todayProps } from "./props";

export { todayProps };

/** iOS vidjetini darhol yangilaydi (ilova ochiq bo‘lganda bosh sahifa yuklanganda). */
export async function updateTodayWidget(home: HomeData) {
  try {
    TodayWidget.updateSnapshot(todayProps(home));
  } catch {
    /* vidjet qo‘shilmagan yoki eski iOS — muhim emas */
  }
}
