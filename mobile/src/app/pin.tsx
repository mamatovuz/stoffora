import { router, useLocalSearchParams } from "expo-router";
import { PinFlow, type PinMode } from "@/components/PinFlow";
import { useSession } from "@/lib/session";

/** PIN-kodni o‘rnatish / o‘zgartirish / o‘chirish (Sozlamalar → Maxfiylik va xavfsizlik). */
export default function PinScreen() {
  const { mode = "set" } = useLocalSearchParams<{ mode?: PinMode }>();
  const { setPrefs } = useSession();
  return (
    <PinFlow
      mode={mode}
      onCancel={() => router.back()}
      onDone={() => {
        void setPrefs({ pinLock: mode !== "disable" }).then(() => router.back());
      }}
    />
  );
}
