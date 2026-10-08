import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import type { Branch, HomeData } from "./types";

/*
 * Fon rejimidagi geofence: filial hududiga kirganda «Ishga keldingizmi?» bildirishnomasi.
 * Ixtiyoriy — xodim «Eslatmalar» ekranida o‘zi yoqadi (fon joylashuvi ruxsati so‘raladi).
 * Joylashuv serverga yuborilmaydi: telefon faqat «filial hududiga kirdi» hodisasini beradi.
 * Kuniga bir martadan ko‘p eslatilmaydi va kelish belgilangan kuni umuman eslatilmaydi.
 */

export const GEOFENCE_TASK = "staffora-geofence";
const STATE_KEY = "staffora.geofence.v1";
// Telefon qulflangan paytda ham o‘qilishi kerak (hodisa fonda keladi) — maxfiy ma’lumot emas.
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

type State = { enabled: boolean; names: Record<string, string>; checkedIn?: string; notified?: string };

const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10); // Toshkent

async function readState(): Promise<State> {
  try {
    const raw = await SecureStore.getItemAsync(STATE_KEY, options);
    return raw ? (JSON.parse(raw) as State) : { enabled: false, names: {} };
  } catch {
    return { enabled: false, names: {} };
  }
}
async function writeState(state: State) {
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state), options).catch(() => undefined);
}

// Vazifa modul yuklanganda (ilova fonda uyg‘onganda ham) e’lon qilinadi — index.ts dan import qilinadi.
TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data || data.eventType !== Location.GeofencingEventType.Enter) return;
  const state = await readState();
  const day = today();
  if (!state.enabled || state.checkedIn === day || state.notified === day) return;
  await writeState({ ...state, notified: day });
  const name = (data.region.identifier && state.names[data.region.identifier]) || "filial";
  await Notifications.scheduleNotificationAsync({
    content: { title: "Ishga keldingizmi?", body: `Siz ${name} yonidasiz. «Ishga keldim»ni bosing.`, data: { go: "checkin" }, sound: "default" },
    trigger: null,
  });
});

function regionsOf(home: HomeData) {
  const list: Branch[] = [...(home.branch ? [home.branch] : []), ...(home.branches || [])];
  const unique = [...new Map(list.filter((b) => b.latitude && b.longitude).map((b) => [b.id, b])).values()].slice(0, 20);
  return unique.map((b) => ({
    identifier: b.id,
    latitude: b.latitude,
    longitude: b.longitude,
    // Juda kichik radiusda telefon hodisani kech sezadi — kamida 150 m.
    radius: Math.max(150, b.radiusMeters || 0),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
}

export async function geofenceEnabled() {
  return (await readState()).enabled;
}

/** Yoqish: avval oddiy, keyin fon joylashuvi ruxsati. Natija: yoqildimi yoki nima yetishmaydi. */
export async function enableGeofence(home: HomeData): Promise<"on" | "foreground-denied" | "background-denied" | "no-branch"> {
  const regions = regionsOf(home);
  if (!regions.length) return "no-branch";
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return "foreground-denied";
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return "background-denied";
  const state = await readState();
  await writeState({ ...state, enabled: true, names: Object.fromEntries([...(home.branches || []), ...(home.branch ? [home.branch] : [])].map((b) => [b.id, b.name])) });
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  return "on";
}

export async function disableGeofence() {
  const state = await readState();
  await writeState({ ...state, enabled: false });
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => undefined);
}

/**
 * Bosh sahifa ma’lumoti kelganda: filiallar o‘zgargan bo‘lsa — hududlarni yangilaydi,
 * bugun kelish belgilangan bo‘lsa — bugun boshqa eslatmaydi.
 */
export async function syncGeofence(home: HomeData) {
  const state = await readState();
  if (!state.enabled) return;
  const day = today();
  const next: State = {
    ...state,
    checkedIn: home.attendance?.checkIn ? day : state.checkedIn,
    names: Object.fromEntries([...(home.branches || []), ...(home.branch ? [home.branch] : [])].map((b) => [b.id, b.name])),
  };
  await writeState(next);
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!bg?.granted) return;
  const regions = regionsOf(home);
  if (regions.length) await Location.startGeofencingAsync(GEOFENCE_TASK, regions).catch(() => undefined);
}
