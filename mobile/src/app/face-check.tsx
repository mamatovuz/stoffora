import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TileMap } from "@/components/TileMap";
import { Button, Icon, haptic } from "@/components/ui";
import { ApiError, errorText, post } from "@/lib/api";
import { FRAME, PLACEMENT_TEXT, grabFrame, placement, probeFace, verifyFaces, type Placement } from "@/lib/faceCamera";
import { duration, tashkentClock } from "@/lib/format";
import { currentFix, distanceMeters, locationPermission, quickFix, type Fix } from "@/lib/location";
import type { Attendance, HomeData } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";
import { flushMarks, knownBranches, queueMark } from "@/lib/offlineMarks";

/*
 * Kundalik Face ID (sozlangandan keyin) — Mini App’dagi kabi, lekin native:
 *  • kamera 3:4 oynada, KESILMAYDI va kattalashtirilmaydi (zoom 0) — yuz tabiiy masofada ko‘rinadi;
 *  • ramka yuzni KUZATADI (server aniqlagan yuz joyiga silliq suriladi); yuz topilmasa — markazda;
 *  • yuz ramkada emas / moslik past — QIZIL; ramkada va moslik ≥ chegara (65%) — YASHIL;
 *  • ~1 soniya yashil turgach kadrlar server Face ID’siga yuboriladi (qaror — serverda);
 *  • pastda xarita: filial, ruxsat etilgan radius va xodim turgan joy.
 * Davomat faqat server tasdiqlagandan keyin «muvaffaqiyatli» ko‘rsatiladi.
 * Internet yo‘q bo‘lsa — kadrlar, GPS va vaqt telefonda saqlanadi (filial hududida bo‘lsa) va
 * aloqa tiklanishi bilan yuboriladi; yakuniy tekshiruv baribir serverda (lib/offlineMarks).
 */

type Phase = "face" | "verifying" | "locating" | "qr" | "committing" | "done" | "error" | "offline" | "saved";
const isOffline = (reason: unknown) => reason instanceof ApiError && reason.code === "NETWORK";
const GREEN_STREAK = 2;

export default function FaceCheck() {
  const insets = useSafeAreaInsets();
  const { action = "CHECK_IN" } = useLocalSearchParams<{ action?: "CHECK_IN" | "CHECK_OUT" }>();
  const { data: home } = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const [fix, setFix] = useState<Fix | null>(null);
  // «Istalgan filialdan» lavozimi: xodim turgan joyga eng mos ruxsat etilgan filial (yakuniy qaror — serverda).
  // Internetsiz ochilganda — telefonda saqlangan oxirgi filiallar ro‘yxati.
  const branchList = useMemo(() => (home?.branches?.length ? home.branches : home?.branch ? [home.branch] : knownBranches()), [home]);
  const branch = useMemo(() => pickBranch(branchList, fix), [branchList, fix]);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("face");
  const [place, setPlace] = useState<Placement | "loading">("loading");
  const [percent, setPercent] = useState<number | null>(null);
  const [pass, setPass] = useState(65);
  const [green, setGreen] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Attendance | null>(null);
  const [gpsError, setGpsError] = useState("");
  const alive = useRef(true);
  const active = useRef(true);
  const session = useRef<{ id: string; requiresQr: boolean; photo: string } | null>(null);
  // Oxirgi tasdiqlangan kadrlar — qayd paytida internet uzilsa, internetsiz belgi uchun.
  const frames = useRef<string[]>([]);
  const [savedAt, setSavedAt] = useState("");
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  // Oxirgi aniqlangan yuz (rasmga nisbatan 0..1) — ramka shu joyga suriladi.
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const anim = useRef({ left: new Animated.Value(0), top: new Animated.Value(0), size: new Animated.Value(0), ready: false }).current;

  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener("change", (s) => (active.current = s === "active"));
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, []);

  /* ---------------------------------------------------- joylashuv --- */
  const locate = useCallback(async (fresh: boolean) => {
    setGpsError("");
    const perm = await locationPermission(true);
    if (perm !== "granted") {
      setGpsError("Joylashuvga ruxsat berilmagan");
      throw new Error("Joylashuvga ruxsat berilmagan. Sozlamalardan Staffora uchun joylashuvni yoqing.");
    }
    if (!fresh) {
      const quick = await quickFix();
      if (quick && alive.current) setFix(quick);
    }
    try {
      const next = await currentFix();
      if (alive.current) setFix(next);
      return next;
    } catch (reason) {
      setGpsError(errorText(reason, "Joylashuv aniqlanmadi"));
      throw reason;
    }
  }, []);
  useEffect(() => {
    void locate(false).catch(() => undefined);
  }, [locate]);

  /* --------------------------------------- GPS → (QR) → davomat --- */
  const afterFace = async () => {
    try {
      setPhase("locating");
      const point = await locate(true);
      // Bir nechta filial: QR kerakmi — turgan joydagi filial rejimiga qarab.
      const here = pickBranch(branchList, point);
      const needQr = branchList.length > 1 ? (here?.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE" : session.current?.requiresQr;
      if (needQr) setPhase("qr");
      else await commit();
    } catch (reason) {
      setError(errorText(reason));
      setPhase("error");
    }
  };
  const commit = async (qrToken?: string) => {
    if (!session.current) return;
    setPhase("committing");
    try {
      const point = await currentFix().catch(() => fix);
      if (!point) throw new Error("Joylashuv aniqlanmadi.");
      const attendance = await post<Attendance>(
        "/mini/attendance/commit",
        {
          sessionId: session.current.id,
          qrToken,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
          positionAge: point.positionAge,
          photoDataUrl: `data:image/jpeg;base64,${session.current.photo}`,
          platform: Platform.OS,
          mocked: point.mocked || undefined,
        },
        25_000,
      );
      invalidate("/mini/");
      haptic.success();
      setResult(attendance);
      setPhase("done");
    } catch (reason) {
      if (isOffline(reason) && frames.current.length >= 2) {
        await saveOffline(frames.current);
        return;
      }
      haptic.error();
      setError(errorText(reason, "Davomat qayd etilmadi."));
      setPhase("error");
    }
  };

  /**
   * Internetsiz belgi: kadrlar (berilmasa — hozir 3 ta olinadi), GPS va vaqt telefonda saqlanadi.
   * Faqat filial hududida (GPS) — aks holda server baribir rad etadi.
   */
  const saveOffline = async (photos?: string[]) => {
    try {
      setPhase("locating");
      let shots = photos && photos.length >= 2 ? photos : [];
      if (shots.length < 2) {
        if (!camera.current) throw new Error("Kamera tayyor emas.");
        for (let i = 0; i < 3; i += 1) {
          shots.push(await grabFrame(camera.current));
          if (i < 2) await new Promise((r) => setTimeout(r, 450));
        }
      }
      shots = shots.slice(-3);
      const point = await locate(true);
      const here = pickBranch(branchList, point);
      if (!here) throw new Error("Filial biriktirilmagan — HR bilan bog‘laning.");
      const away = Math.round(distanceMeters(point.latitude, point.longitude, here.latitude, here.longitude) - here.radiusMeters - Math.min(35, point.accuracy));
      if (away > 0) throw new Error(`Siz filial hududidan ${away} m tashqaridasiz — internetsiz belgi faqat filial hududida saqlanadi.`);
      queueMark({ action, photos: shots, latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy });
      haptic.success();
      setSavedAt(tashkentClock());
      setPhase("saved");
      // Aloqa shu orada tiklangan bo‘lishi mumkin — darhol urinib ko‘ramiz.
      void flushMarks().catch(() => undefined);
    } catch (reason) {
      haptic.error();
      setError(errorText(reason, "Belgini saqlab bo‘lmadi."));
      setPhase("error");
    }
  };
  /* ------------------------------------------------- yuz tsikli --- */
  // Yuz tsikli — afterFace / saveOffline e’lon qilingandan keyin (effekt ularni chaqiradi).
  useEffect(() => {
    if (!ready || phase !== "face" || !permission?.granted) return;
    let stop = false;
    let streak = 0;
    let greens: string[] = [];
    let smooth: number | null = null;
    let offline = 0;
    (async () => {
      while (!stop && alive.current) {
        if (!active.current || !camera.current) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        let photo: string;
        let probe: Awaited<ReturnType<typeof probeFace>>;
        try {
          photo = await grabFrame(camera.current);
          if (stop) return;
          probe = await probeFace(photo);
        } catch (reason) {
          if (stop || !alive.current) return;
          // Internet yo‘q (ketma-ket 2 marta) — telefonda saqlash rejimi.
          if (isOffline(reason) && ++offline >= 2) {
            stop = true;
            setPhase("offline");
            return;
          }
          // Server rad etsa (masalan, Face ID sozlanmagan) — to‘xtaymiz; tarmoq/kadr xatosi — davom.
          if (reason instanceof ApiError && reason.status >= 400 && reason.status !== 429 && reason.status !== 503) {
            setError(errorText(reason));
            setPhase("error");
            return;
          }
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (stop) return;
        offline = 0;
        // Serverni ortiqcha yuklamaslik: kadrlar orasida kamida ~0.6 soniya.
        await new Promise((r) => setTimeout(r, 600));
        if (stop) return;
        setPass(probe.passPercent);
        setFaceBox(probe.face?.box ?? null);
        const where = placement(probe.face);
        smooth = !probe.face || probe.percent === null ? null : smooth === null ? probe.percent : Math.round(smooth * 0.5 + probe.percent * 0.5);
        setPercent(smooth);
        const ok = where === "ok" && smooth !== null && smooth >= probe.passPercent;
        setPlace(where);
        setGreen(ok);
        if (!ok) {
          streak = 0;
          greens = [];
          continue;
        }
        if (!streak) haptic.tap();
        streak += 1;
        greens.push(photo);
        if (streak < GREEN_STREAK) continue;

        /* ------------------------------- yakuniy tekshiruv (serverda) --- */
        stop = true;
        haptic.success();
        setPhase("verifying");
        frames.current = greens.slice(-3);
        try {
          const verified = await verifyFaces(greens.slice(-3));
          const created = await post<{ id: string; requiresQr: boolean }>("/mini/attendance/session", { action, faceProof: verified.proof });
          session.current = { id: created.id, requiresQr: created.requiresQr, photo: greens[greens.length - 1] };
          setPercent(verified.percent);
        } catch (reason) {
          if (!alive.current) return;
          if (isOffline(reason)) {
            await saveOffline(frames.current);
            return;
          }
          if (reason instanceof ApiError && ["NO_FACE", "NOT_LIVE", "REPLAY"].includes(reason.code || "")) {
            // Kadrlar yaroqsiz — jimgina qaytadan (effekt qayta ishga tushadi).
            setGreen(false);
            setPhase("face");
            return;
          }
          haptic.error();
          setError(reason instanceof ApiError && reason.code === "FACE_MISMATCH" ? "Yuz profildagi Face ID bilan mos kelmadi. Yorug‘roq joyda qayta urinib ko‘ring." : errorText(reason));
          setPhase("error");
          return;
        }
        await afterFace();
        return;
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase, permission?.granted]);

  const scanned = useRef(false);
  const onQr = (event: BarcodeScanningResult) => {
    if (scanned.current) return;
    const value = event.data.trim();
    if (value.split(".").length !== 3) return;
    scanned.current = true;
    haptic.medium();
    void commit(value);
  };

  const retry = () => {
    setError("");
    setResult(null);
    setPercent(null);
    setGreen(false);
    setPlace("loading");
    setFaceBox(null);
    scanned.current = false;
    session.current = null;
    setPhase("face");
  };

  /* ------------------------------------------- ramka: yuzni kuzatish --- */
  // Rasm (3:4) kamera maydonini «cover» bilan to‘ldiradi. Old kamera ko‘rinishi ko‘zgudek — x teskari.
  const frameBox = useMemo(() => {
    if (!area) return null;
    const scale = Math.max(area.w / 3, area.h / 4);
    const iw = 3 * scale;
    const ih = 4 * scale;
    const ox = area.w / 2 - iw / 2;
    const oy = area.h / 2 - ih / 2;
    if (faceBox && phase === "face") {
      const size = Math.min(area.w * 0.95, Math.max(faceBox.width * iw, faceBox.height * ih * 0.9) * 1.3);
      const cx = ox + (1 - faceBox.x - faceBox.width / 2) * iw;
      const cy = oy + (faceBox.y + faceBox.height / 2) * ih;
      return { size, left: cx - size / 2, top: cy - size / 2 };
    }
    const size = FRAME.w * iw;
    return { size, left: area.w / 2 - size / 2, top: area.h / 2 + (FRAME.cy - 0.5) * ih - size / 2 };
  }, [area, faceBox, phase]);
  useEffect(() => {
    if (!frameBox) return;
    if (!anim.ready) {
      anim.left.setValue(frameBox.left);
      anim.top.setValue(frameBox.top);
      anim.size.setValue(frameBox.size);
      anim.ready = true;
      return;
    }
    const spring = (v: Animated.Value, to: number) => Animated.spring(v, { toValue: to, useNativeDriver: false, speed: 14, bounciness: 4 });
    Animated.parallel([spring(anim.left, frameBox.left), spring(anim.top, frameBox.top), spring(anim.size, frameBox.size)]).start();
  }, [frameBox, anim]);

  /* ---------------------------------------------------------- UI --- */
  const gap = fix && branch ? Math.round(distanceMeters(fix.latitude, fix.longitude, branch.latitude, branch.longitude)) : null;
  const inside = gap !== null && branch ? gap - Math.min(35, fix!.accuracy) <= branch.radiusMeters : null;
  const tone = phase === "face" ? (place === "loading" || place === "none" ? "idle" : green ? "ok" : "bad") : phase === "error" ? "bad" : "ok";
  const color = tone === "ok" ? "#30D158" : tone === "bad" ? "#FF453A" : "rgba(255,255,255,0.9)";
  const pill =
    phase === "verifying"
      ? "Tekshirilmoqda…"
      : phase === "locating"
        ? "Joylashuv aniqlanmoqda…"
        : phase === "committing"
          ? "Qayd etilmoqda…"
          : phase === "qr"
            ? "Filial ekranidagi QR kodni skanerlang"
            : phase === "offline"
              ? "Internet yo‘q — yuzingizni ramkaga qo‘yib, «Telefonda saqlash»ni bosing"
            : phase === "error"
              ? error
              : place === "loading"
                ? "Kamera tayyorlanmoqda…"
                : green
                  ? `Yuz tanildi${percent !== null ? ` · ${percent}%` : ""} — qimirlamang`
                  : place === "ok" && percent !== null
                    ? `Yuz tanilmadi · ${percent}%`
                    : PLACEMENT_TEXT[place];

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted)
    return (
      <View style={[st.root, { paddingTop: insets.top + 40, paddingHorizontal: 24, gap: 16, alignItems: "center" }]}>
        <Icon name="camera-outline" size={54} color="#fff" />
        <Text style={st.permTitle}>Kameraga ruxsat kerak</Text>
        <Text style={st.permText}>Ishga kelish/ketishda yuzingiz tekshiriladi. Rasm faqat tekshiruv uchun serverga yuboriladi.</Text>
        {permission.canAskAgain ? <Button title="Ruxsat berish" onPress={() => void requestPermission()} style={{ alignSelf: "stretch" }} /> : <Button title="Sozlamalarni ochish" onPress={() => void Linking.openSettings()} style={{ alignSelf: "stretch" }} />}
        <Button title="Orqaga" tone="ghost" onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
      </View>
    );

  if (phase === "done" && result) return <Receipt action={action} attendance={result} percent={percent} branchName={branch?.name} distance={gap} />;
  if (phase === "saved") return <SavedOffline action={action} time={savedAt} branchName={branch?.name} />;

  return (
    <View style={st.root}>
      {/* Kamera — tepada to‘liq; yuz turadigan joyda bitta ramka */}
      <View style={st.camera} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {phase === "qr" ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onQr} />
        ) : (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" zoom={0} animateShutter={false} mirror={false} onCameraReady={() => setReady(true)} />
        )}
        {frameBox && phase !== "qr" ? (
          <Animated.View pointerEvents="none" style={[st.frame, { width: anim.size, height: anim.size, left: anim.left, top: anim.top }]}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[cornerStyle(i), { borderColor: color }]} />
            ))}
          </Animated.View>
        ) : null}
        {phase === "verifying" || phase === "locating" || phase === "committing" ? (
          <View style={[StyleSheet.absoluteFill, st.busy]}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}

        <View style={[st.top, { paddingTop: insets.top + 8 }]}>
          <Text style={st.topTitle}>{action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"}</Text>
          <Text style={st.topSub} numberOfLines={1}>
            {tashkentClock()} · {branch?.name || "Filial"}
          </Text>
        </View>

        <View style={st.statusWrap}>
          <View style={[st.status, tone === "ok" && { backgroundColor: "rgba(48,209,88,0.95)" }, tone === "bad" && phase === "error" && { backgroundColor: "rgba(255,69,58,0.92)" }]}>
            <Text style={st.statusText} numberOfLines={2}>
              {pill}
            </Text>
          </View>
        </View>
      </View>

      {/* Pastda — xarita (ortiqcha narsalarsiz) va tugma */}
      <View style={[st.panel, { paddingBottom: insets.bottom + 10 }]}>
        {branch ? (
          <View style={st.mapWrap}>
            <TileMap
              compact
              height={210}
              fitKey={`${branch.id}:${fix ? "me" : ""}`}
              points={[
                { id: "branch", lat: branch.latitude, lng: branch.longitude, kind: "branch", label: branch.name, tone: "info" },
                ...(fix ? [{ id: "me", lat: fix.latitude, lng: fix.longitude, kind: "me" as const, label: "Siz", tone: "ok" as const }] : []),
              ]}
              circles={[{ id: "r", lat: branch.latitude, lng: branch.longitude, radius: branch.radiusMeters }]}
            />
            <View style={st.mapNote}>
              <Text style={st.mapNoteText} numberOfLines={1}>
                {fix
                  ? inside
                    ? `Filial hududidasiz · ±${fix.accuracy} m`
                    : `Filialdan ${Math.max(0, (gap || 0) - branch.radiusMeters)} m uzoqda`
                  : gpsError || "Joylashuv aniqlanmoqda…"}
              </Text>
              {gpsError || inside === false ? (
                <Pressable onPress={() => void locate(true).catch(() => undefined)} hitSlop={10}>
                  <Icon name="refresh" size={15} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={st.nobranch}>
            <Text style={{ color: "#aaa" }}>Filial biriktirilmagan — HR bilan bog‘laning</Text>
          </View>
        )}
        <View style={st.actions}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [st.action, pressed && { opacity: 0.7 }]}>
            <Text style={st.actionText}>Orqaga</Text>
          </Pressable>
          {phase === "error" ? (
            <Pressable onPress={retry} style={({ pressed }) => [st.action, { backgroundColor: "#0A84FF" }, pressed && { opacity: 0.8 }]}>
              <Text style={st.actionText}>Qayta urinish</Text>
            </Pressable>
          ) : null}
          {phase === "offline" ? (
            <Pressable onPress={() => void saveOffline()} style={({ pressed }) => [st.action, { backgroundColor: "#0A84FF" }, pressed && { opacity: 0.8 }]}>
              <Text style={st.actionText}>Telefonda saqlash</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Joylashuvga eng mos filial: hududi ichida (aniqlik hisobga olingan) va eng yaqini. */
function pickBranch<T extends { latitude: number; longitude: number; radiusMeters: number }>(list: T[], fix: Fix | null): T | null {
  if (!list.length) return null;
  if (!fix || list.length === 1) return list[0];
  const slack = Math.min(35, fix.accuracy);
  const outside = (b: T) => distanceMeters(fix.latitude, fix.longitude, b.latitude, b.longitude) - b.radiusMeters - slack;
  return [...list].sort((a, b) => outside(a) - outside(b))[0];
}

function cornerStyle(i: number) {
  const r = 22;
  const base = { position: "absolute" as const, width: "22%" as const, height: "22%" as const, borderWidth: 3 };
  if (i === 0) return { ...base, left: 0, top: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: r };
  if (i === 1) return { ...base, right: 0, top: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: r };
  if (i === 2) return { ...base, right: 0, bottom: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: r };
  return { ...base, left: 0, bottom: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: r };
}

/** Internetsiz saqlandi: aloqa tiklanishi bilan yuboriladi (yakuniy tekshiruv serverda). */
function SavedOffline({ action, time, branchName }: { action: string; time: string; branchName?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.root, { paddingTop: insets.top + 60, paddingHorizontal: 24, alignItems: "center", gap: 14 }]}>
      <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: "rgba(10,132,255,0.18)", alignItems: "center", justifyContent: "center" }}>
        <Icon name="cloud-offline-outline" size={44} color="#0A84FF" />
      </View>
      <Text style={st.permTitle}>{action === "CHECK_IN" ? "Kelish" : "Ketish"} telefonda saqlandi</Text>
      <Text style={{ color: "#fff", fontSize: 44, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{time}</Text>
      <Text style={st.permText}>
        {branchName ? `${branchName} · ` : ""}Internet tiklanishi bilan avtomatik yuboriladi. Server yuzingiz va joylashuvingizni tekshiradi — natija bildirishnomada keladi.
      </Text>
      <Button title="Tayyor" onPress={() => router.back()} style={{ alignSelf: "stretch", marginTop: 12 }} />
    </View>
  );
}

/** Natija: faqat server qayd etgandan keyin ko‘rsatiladi. */
function Receipt({ action, attendance, percent, branchName, distance }: { action: string; attendance: Attendance; percent: number | null; branchName?: string; distance: number | null }) {
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [scale]);
  const time = action === "CHECK_IN" ? attendance.checkIn : attendance.checkOut;
  const late = action === "CHECK_IN" && attendance.lateMinutes > 0;
  const rows: [string, string][] = [
    ["Vaqt", time || tashkentClock()],
    ["Filial", branchName || "—"],
    ...(distance !== null ? ([["Masofa", `${distance} m`]] as [string, string][]) : []),
    ...(percent !== null ? ([["Face ID", `${percent}% moslik`]] as [string, string][]) : []),
    ...(action === "CHECK_OUT" ? ([["Ishlangan", `${Math.floor(attendance.workedMinutes / 60)} soat ${attendance.workedMinutes % 60} daq`]] as [string, string][]) : []),
  ];
  return (
    <View style={[st.root, { paddingTop: insets.top + 50, paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }]}>
      <View style={{ alignItems: "center", gap: 14, flex: 1 }}>
        <Animated.View style={[st.check, { backgroundColor: late ? "#FF9F0A" : "#30D158", transform: [{ scale }] }]}>
          <Icon name="checkmark" size={56} color="#fff" />
        </Animated.View>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "700" }}>{action === "CHECK_IN" ? "Ishga keldingiz" : "Ishdan ketdingiz"}</Text>
        <Text style={{ color: late ? "#FF9F0A" : "#8E8E93", fontSize: 15.5 }}>{late ? `${duration(attendance.lateMinutes)} kechikdingiz` : action === "CHECK_IN" ? "Vaqtida — rahmat!" : "Yaxshi dam oling!"}</Text>
        <View style={st.receipt}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[st.receiptRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#38383A" }]}>
              <Text style={{ color: "#8E8E93", fontSize: 15 }}>{k}</Text>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>{v}</Text>
            </View>
          ))}
        </View>
        {attendance.flags?.length ? <Text style={{ color: "#FF9F0A", fontSize: 12.5, textAlign: "center" }}>Belgi HR tomonidan ko‘rib chiqiladi.</Text> : null}
      </View>
      <Button title="Tayyor" onPress={() => router.back()} big />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1, backgroundColor: "#111", overflow: "hidden" },
  frame: { position: "absolute" },
  busy: { backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", paddingBottom: 10 },
  topTitle: { color: "#fff", fontSize: 17, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  topSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  statusWrap: { position: "absolute", left: 0, right: 0, bottom: 40, alignItems: "center", paddingHorizontal: 24 },
  status: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)" },
  statusText: { color: "#fff", fontSize: 15, fontWeight: "600", textAlign: "center" },
  panel: { marginTop: -26, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: "hidden", backgroundColor: "#0B0B0C" },
  mapWrap: { position: "relative" },
  mapNote: { position: "absolute", left: 12, bottom: 12, maxWidth: "80%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(20,20,22,0.82)" },
  mapNoteText: { color: "#fff", fontSize: 13, fontWeight: "500", flexShrink: 1 },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  action: { flex: 1, height: 52, borderRadius: 16, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
  actionText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  nobranch: { height: 80, borderRadius: 16, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
  permTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  permText: { color: "#aaa", fontSize: 15, textAlign: "center", lineHeight: 21 },
  check: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  receipt: { alignSelf: "stretch", marginTop: 18, borderRadius: 16, backgroundColor: "#1C1C1E", paddingHorizontal: 16 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
});
