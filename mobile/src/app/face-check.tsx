import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";
import { MiniMap } from "@/components/MiniMap";
import { Button, Icon, haptic } from "@/components/ui";
import { ApiError, errorText, post } from "@/lib/api";
import { FRAME, PLACEMENT_TEXT, grabFrame, placement, probeFace, verifyFaces, type Placement } from "@/lib/faceCamera";
import { tashkentClock } from "@/lib/format";
import { currentFix, distanceMeters, locationPermission, quickFix, type Fix } from "@/lib/location";
import type { Attendance, HomeData } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";

/*
 * Kundalik Face ID (sozlangandan keyin) — Mini App’dagi kabi, lekin native:
 *  • kamera 3:4 oynada, KESILMAYDI va kattalashtirilmaydi (zoom 0) — yuz tabiiy masofada ko‘rinadi;
 *  • ramka markazda QOTIRILGAN — xodim yuzini ramkaga o‘zi olib keladi;
 *  • yuz ramkada emas / moslik past — QIZIL; ramkada va moslik ≥ chegara (65%) — YASHIL;
 *  • ~1 soniya yashil turgach kadrlar server Face ID’siga yuboriladi (qaror — serverda);
 *  • pastda xarita: filial, ruxsat etilgan radius va xodim turgan joy.
 * Davomat faqat server tasdiqlagandan keyin «muvaffaqiyatli» ko‘rsatiladi.
 */

type Phase = "face" | "verifying" | "locating" | "qr" | "committing" | "done" | "error";
const GREEN_STREAK = 2;

export default function FaceCheck() {
  const insets = useSafeAreaInsets();
  const { action = "CHECK_IN" } = useLocalSearchParams<{ action?: "CHECK_IN" | "CHECK_OUT" }>();
  const { data: home } = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const [fix, setFix] = useState<Fix | null>(null);
  // «Istalgan filialdan» lavozimi: xodim turgan joyga eng mos ruxsat etilgan filial (yakuniy qaror — serverda).
  const branchList = useMemo(() => (home?.branches?.length ? home.branches : home?.branch ? [home.branch] : []), [home]);
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
  const [holdValue, setHoldValue] = useState(0);

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

  /* ------------------------------------------------- yuz tsikli --- */
  useEffect(() => {
    if (!ready || phase !== "face" || !permission?.granted) return;
    let stop = false;
    let streak = 0;
    let greens: string[] = [];
    let smooth: number | null = null;
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
          // Server rad etsa (masalan, Face ID sozlanmagan) — to‘xtaymiz; tarmoq/kadr xatosi — davom.
          if (reason instanceof ApiError && reason.status >= 400 && reason.status !== 429) {
            setError(errorText(reason));
            setPhase("error");
            return;
          }
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (stop) return;
        setPass(probe.passPercent);
        const where = placement(probe.face);
        smooth = !probe.face || probe.percent === null ? null : smooth === null ? probe.percent : Math.round(smooth * 0.5 + probe.percent * 0.5);
        setPercent(smooth);
        const ok = where === "ok" && smooth !== null && smooth >= probe.passPercent;
        setPlace(where);
        setGreen(ok);
        if (!ok) {
          streak = 0;
          greens = [];
          setHoldValue(0);
          continue;
        }
        if (!streak) haptic.tap();
        streak += 1;
        greens.push(photo);
        setHoldValue(Math.min(1, streak / GREEN_STREAK));
        if (streak < GREEN_STREAK) continue;

        /* ------------------------------- yakuniy tekshiruv (serverda) --- */
        stop = true;
        haptic.success();
        setPhase("verifying");
        try {
          const verified = await verifyFaces(greens.slice(-3));
          const created = await post<{ id: string; requiresQr: boolean }>("/mini/attendance/session", { action, faceProof: verified.proof });
          session.current = { id: created.id, requiresQr: created.requiresQr, photo: greens[greens.length - 1] };
          setPercent(verified.percent);
        } catch (reason) {
          if (!alive.current) return;
          if (reason instanceof ApiError && ["NO_FACE", "NOT_LIVE", "REPLAY"].includes(reason.code || "")) {
            // Kadrlar yaroqsiz — jimgina qaytadan (effekt qayta ishga tushadi).
            setHoldValue(0);
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
      haptic.error();
      setError(errorText(reason, "Davomat qayd etilmadi."));
      setPhase("error");
    }
  };
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
    setHoldValue(0);
    scanned.current = false;
    session.current = null;
    setPhase("face");
  };

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

  return (
    <View style={st.root}>
      <View style={[st.top, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} style={st.round} hitSlop={8} accessibilityLabel="Orqaga">
          <Icon name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.topTitle}>{action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"}</Text>
          <Text style={st.topSub} numberOfLines={1}>
            {tashkentClock()} · {branch?.name || "Filial"}
          </Text>
        </View>
        {percent !== null && phase === "face" ? (
          <View style={[st.percent, { backgroundColor: green ? "#30D158" : place === "ok" ? "#FF453A" : "rgba(255,255,255,0.18)" }]}>
            <Text style={{ color: "#fff", fontWeight: "700", fontVariant: ["tabular-nums"] }}>{percent}%</Text>
          </View>
        ) : null}
      </View>

      {/* Kamera oynasi: 3:4, kesilmaydi; ramka markazda qotirilgan. */}
      <View style={st.stage}>
        <View style={st.view}>
          {phase === "qr" ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onQr} />
          ) : (
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" zoom={0} ratio="4:3" animateShutter={false} mirror={false} onCameraReady={() => setReady(true)} />
          )}
          <View style={[st.frame, { width: `${FRAME.w * 100}%`, top: `${(FRAME.cy - FRAME.h / 2) * 100}%` }]} pointerEvents="none">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[cornerStyle(i), { borderColor: color }]} />
            ))}
            {phase === "face" && green ? <HoldRing progress={holdValue} /> : null}
            {phase === "face" && !green ? <ScanLine color={tone === "bad" ? "#FF6B6B" : "#FFFFFF"} /> : null}
          </View>
          {phase !== "face" && phase !== "qr" && phase !== "error" ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" }]}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          ) : null}
          <View style={[st.pill, { backgroundColor: tone === "ok" ? "rgba(48,209,88,0.92)" : tone === "bad" ? "rgba(255,69,58,0.9)" : "rgba(20,20,22,0.72)" }]}>
            <Text style={st.pillText} numberOfLines={2}>
              {pill}
            </Text>
          </View>
        </View>
        {phase === "face" && place === "ok" && !green && percent !== null ? <Text style={st.need}>Kerak: {pass}% dan yuqori</Text> : null}
      </View>

      {/* Xarita va amallar */}
      <View style={[st.panel, { paddingBottom: insets.bottom + 12 }]}>
        {branch ? (
          <MiniMap branch={branch} radius={branch.radiusMeters} me={fix} height={150}>
            <View style={st.gps}>
              <Icon name={fix ? "navigate" : "location-outline"} size={14} color={fix ? (inside ? "#4ADE80" : "#F87171") : "#fff"} />
              <Text style={st.gpsText} numberOfLines={1}>
                {fix
                  ? inside
                    ? `Filial hududidasiz · ${gap} m · ±${fix.accuracy} m`
                    : `Filialdan ${Math.max(0, (gap || 0) - branch.radiusMeters)} m uzoqdasiz · ±${fix.accuracy} m`
                  : gpsError || "Joylashuv aniqlanmoqda…"}
              </Text>
              {gpsError || inside === false ? (
                <Pressable onPress={() => void locate(true).catch(() => undefined)} hitSlop={10}>
                  <Icon name="refresh" size={15} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          </MiniMap>
        ) : (
          <View style={st.nobranch}>
            <Text style={{ color: "#aaa" }}>Filial biriktirilmagan — HR bilan bog‘laning</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Button title="Orqaga" tone="ghost" onPress={() => router.back()} style={{ flex: 0, minWidth: 110, backgroundColor: "#1C1C1E", borderColor: "#2C2C2E" }} />
          {phase === "error" ? (
            <Button title="Qayta urinish" icon="refresh" onPress={retry} style={{ flex: 1 }} />
          ) : (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Text style={{ color: "#8E8E93", textAlign: "center", fontSize: 13 }}>
                {phase === "qr" ? "QR kod avtomatik o‘qiladi" : green ? "Qimirlamang…" : `Yashil bo‘lsa — avtomatik ${action === "CHECK_IN" ? "keldi" : "ketdi"}`}
              </Text>
            </View>
          )}
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
  const r = 18;
  const base = { position: "absolute" as const, width: "26%" as const, height: "26%" as const, borderWidth: 3.5 };
  if (i === 0) return { ...base, left: 0, top: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: r };
  if (i === 1) return { ...base, right: 0, top: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: r };
  if (i === 2) return { ...base, right: 0, bottom: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: r };
  return { ...base, left: 0, bottom: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: r };
}

/** Yumaloq to‘rtburchak perimetri (97×97, rx 14) — progress chizig‘i uchun. */
const PERIMETER = 4 * (97 - 28) + 2 * Math.PI * 14;
/** Qidiruv paytida ramka ichida yuqoridan pastga yuradigan yumshoq chiziq. */
function ScanLine({ color }: { color: string }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(y, { toValue: 1, duration: 2100, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [y]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          height: 2,
          borderRadius: 2,
          backgroundColor: color,
          shadowColor: color,
          shadowOpacity: 0.9,
          shadowRadius: 8,
          opacity: y.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 0.9, 0.9, 0] }),
          transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [12, 200] }) }],
        }}
      />
    </View>
  );
}

function HoldRing({ progress }: { progress: number }) {
  return (
    <Svg style={{ position: "absolute", left: -7, top: -7, right: -7, bottom: -7 }} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Rect x={1.5} y={1.5} width={97} height={97} rx={14} fill="none" stroke="#30D158" strokeWidth={2.2} strokeLinecap="round" strokeDasharray={`${progress * PERIMETER} ${PERIMETER}`} />
    </Svg>
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
        <Text style={{ color: late ? "#FF9F0A" : "#8E8E93", fontSize: 15.5 }}>{late ? `${attendance.lateMinutes} daqiqa kechikdingiz` : action === "CHECK_IN" ? "Vaqtida — rahmat!" : "Yaxshi dam oling!"}</Text>
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
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingBottom: 8 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  topTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  topSub: { color: "rgba(255,255,255,0.7)", fontSize: 12.5 },
  percent: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 99 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  view: { width: "100%", maxHeight: "100%", aspectRatio: 3 / 4, borderRadius: 28, overflow: "hidden", backgroundColor: "#111" },
  frame: { position: "absolute", left: `${(1 - FRAME.w) * 50}%`, aspectRatio: 1 },
  pill: { position: "absolute", left: 16, right: 16, bottom: 16, alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  pillText: { color: "#fff", fontSize: 15, fontWeight: "600", textAlign: "center" },
  need: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 6 },
  panel: { paddingHorizontal: 12, paddingTop: 10, backgroundColor: "#000" },
  gps: { position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(15,23,42,0.78)" },
  gpsText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "500" },
  nobranch: { height: 80, borderRadius: 16, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
  permTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  permText: { color: "#aaa", fontSize: 15, textAlign: "center", lineHeight: 21 },
  check: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  receipt: { alignSelf: "stretch", marginTop: 18, borderRadius: 16, backgroundColor: "#1C1C1E", paddingHorizontal: 16 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
});
