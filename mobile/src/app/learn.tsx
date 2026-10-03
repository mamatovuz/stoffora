import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, Group, Icon, Loading, Row, Segmented, Sheet, haptic } from "@/components/ui";
import { api, errorText, post } from "@/lib/api";
import { dateUz } from "@/lib/format";
import { mediaUri } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

/*
 * «O‘qish va ID»: kurslar (darslar + test, ball serverda), bilimlar bazasi va raqamli ID (QR).
 * Mini App bilan bir xil API.
 */

type View3 = "courses" | "kb" | "badge";
type CourseRow = { id: string; title: string; lessons: number; questions: number; passPercent: number; dueDate?: string; required: boolean; status: "NEW" | "PASSED" | "FAILED" | "OVERDUE"; best: number; attempts: number };
type CourseFull = { id: string; title: string; description?: string; lessons: { title: string; body: string }[]; questions: { id: string; q: string; options: string[] }[]; passPercent: number; status: string };
type Article = { id: string; title: string; category: string; pinned: boolean; excerpt: string };
type Badge = { qr: string; expiresAt: string; company: string; employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string } };
const CHIP: Record<CourseRow["status"], [string, "warn" | "ok" | "bad"]> = { NEW: ["Yangi", "warn"], PASSED: ["Topshirildi", "ok"], FAILED: ["Qayta topshiring", "bad"], OVERDUE: ["Muddati o‘tgan", "bad"] };

export default function LearnScreen() {
  const params = useLocalSearchParams<{ view?: View3 }>();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [view, setView] = useState<View3>(params.view || "courses");
  const [course, setCourse] = useState<string | null>(null);
  const [article, setArticle] = useState<string | null>(null);
  useLayoutEffect(() => {
    navigation.setOptions({ title: "O‘qish va ID" });
  }, [navigation]);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Segmented<View3>
        value={view}
        onChange={setView}
        options={[
          ["courses", "Kurslar"],
          ["kb", "Bilimlar"],
          ["badge", "Mening ID"],
        ]}
      />
      {view === "courses" ? <Courses onOpen={setCourse} /> : view === "kb" ? <Knowledge onOpen={setArticle} /> : <BadgeCard />}
      <CourseSheet id={course} onClose={() => setCourse(null)} />
      <ArticleSheet id={article} onClose={() => setArticle(null)} />
    </ScrollView>
  );
}

function Courses({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error, reload } = useData<CourseRow[]>("/mini/courses", { maxAgeMs: 0 });
  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty icon="school-outline" title="Kurslar yo‘q" text="HR kurs tayinlasa — shu yerda chiqadi." />;
  return (
    <Group>
      {data.map((x, i) => (
        <Row
          key={x.id}
          icon="school"
          label={x.title}
          sub={`${x.lessons} dars · ${x.questions} savol${x.dueDate ? ` · ${dateUz(x.dueDate)} gacha` : ""}${x.attempts ? ` · ${x.best}%` : ""}`}
          right={<Badge text={CHIP[x.status][0]} tone={CHIP[x.status][1]} />}
          onPress={() => onOpen(x.id)}
          last={i === data.length - 1}
        />
      ))}
    </Group>
  );
}

function CourseSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { c } = useTheme();
  const [course, setCourse] = useState<CourseFull | null>(null);
  const [lesson, setLesson] = useState(0);
  const [testing, setTesting] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean; passPercent: number; wrong: number[] } | null>(null);
  useEffect(() => {
    if (!id) return;
    setCourse(null);
    setResult(null);
    setTesting(false);
    setLesson(0);
    void api<CourseFull>(`/mini/courses/${id}`)
      .then((v) => {
        setCourse(v);
        setAnswers(v.questions.map(() => -1));
      })
      .catch((e) => Alert.alert("Xatolik", errorText(e)));
  }, [id]);
  const submit = async () => {
    if (!course) return;
    setBusy(true);
    try {
      const r = await post<NonNullable<typeof result>>(`/mini/courses/${course.id}/attempt`, { answers });
      setResult(r);
      r.passed ? haptic.success() : haptic.error();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={Boolean(id)} title={course?.title || "Kurs"} subtitle={course?.description} onClose={onClose}>
      {!course ? (
        <Loading />
      ) : result ? (
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
          <Icon name={result.passed ? "checkmark-circle" : "close-circle"} size={56} color={result.passed ? c.success : c.danger} />
          <Text style={{ color: c.ink, fontSize: 32, fontWeight: "700" }}>{result.score}%</Text>
          <Text style={{ color: c.muted }}>{result.passed ? "Tabriklaymiz — kurs topshirildi!" : `O‘tish uchun ${result.passPercent}% kerak`}</Text>
          {result.wrong.length ? <Text style={{ color: c.muted, fontSize: 13 }}>Xato savollar: {result.wrong.join(", ")}</Text> : null}
          <Button title={result.passed ? "Tayyor" : "Qayta topshirish"} onPress={() => (result.passed ? onClose() : (setResult(null), setAnswers(course.questions.map(() => -1))))} style={{ alignSelf: "stretch", marginTop: 8 }} />
        </View>
      ) : testing ? (
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 12 }}>
          {course.questions.map((q, i) => (
            <View key={q.id} style={{ gap: 6 }}>
              <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>
                {i + 1}. {q.q}
              </Text>
              {q.options.map((o, j) => (
                <Pressable key={j} onPress={() => (haptic.select(), setAnswers(answers.map((a, k) => (k === i ? j : a))))} style={[st.opt, { backgroundColor: answers[i] === j ? `${c.accent}1F` : c.tint }]}>
                  <Icon name={answers[i] === j ? "radio-button-on" : "radio-button-off"} size={18} color={answers[i] === j ? c.accent : c.muted} />
                  <Text style={{ color: answers[i] === j ? c.accent : c.ink, flex: 1 }}>{o}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          <Button title="Javoblarni yuborish" busy={busy} disabled={answers.some((a) => a < 0)} onPress={() => void submit()} />
        </ScrollView>
      ) : (
        <View style={{ gap: 10 }}>
          {course.lessons.length ? (
            <>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {course.lessons.map((_, i) => (
                  <Pressable key={i} onPress={() => setLesson(i)} style={[st.step, { backgroundColor: i === lesson ? c.accent : c.tint }]}>
                    <Text style={{ color: i === lesson ? "#fff" : c.ink, fontWeight: "600" }}>{i + 1}</Text>
                  </Pressable>
                ))}
              </View>
              <ScrollView style={{ maxHeight: 380 }}>
                <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>{course.lessons[lesson].title}</Text>
                <Text style={{ color: c.ink, fontSize: 15, lineHeight: 22 }}>{course.lessons[lesson].body}</Text>
              </ScrollView>
            </>
          ) : (
            <Text style={{ color: c.muted }}>Bu kursda faqat test bor.</Text>
          )}
          <Button title={course.status === "PASSED" ? "Testni qayta yechish" : "Testni boshlash"} icon="create-outline" onPress={() => setTesting(true)} />
        </View>
      )}
    </Sheet>
  );
}

function Knowledge({ onOpen }: { onOpen: (id: string) => void }) {
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Article[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void api<Article[]>(`/mini/kb${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then(setRows)
        .catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <View style={[st.search, { backgroundColor: c.card }]}>
        <Icon name="search" size={17} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Qoida, yo‘riqnoma, savol…" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} />
      </View>
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="book-outline" title={q ? "Topilmadi" : "Hali maqola yo‘q"} />
      ) : (
        <Group>
          {rows.map((a, i) => (
            <Row key={a.id} icon={a.pinned ? "pin" : "book"} label={a.title} sub={`${a.category} · ${a.excerpt}`} onPress={() => onOpen(a.id)} last={i === rows.length - 1} />
          ))}
        </Group>
      )}
    </>
  );
}

function ArticleSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { c } = useTheme();
  const [a, setA] = useState<{ title: string; body: string; category: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    setA(null);
    void api<typeof a>(`/mini/kb/${id}`)
      .then(setA)
      .catch(() => onClose());
  }, [id, onClose]);
  return (
    <Sheet visible={Boolean(id)} title={a?.title || "Maqola"} subtitle={a?.category} onClose={onClose}>
      {!a ? (
        <Loading />
      ) : (
        <ScrollView style={{ maxHeight: 520 }}>
          <Text style={{ color: c.ink, fontSize: 15.5, lineHeight: 23 }}>{a.body}</Text>
        </ScrollView>
      )}
    </Sheet>
  );
}

function BadgeCard() {
  const { c } = useTheme();
  const [b, setB] = useState<Badge | null>(null);
  const [left, setLeft] = useState(0);
  const load = useCallback(() => {
    void api<Badge>("/mini/badge")
      .then(setB)
      .catch(() => setB(null));
  }, []);
  useEffect(load, [load]);
  // QR 2 daqiqa amal qiladi — tugashidan oldin o‘zi yangilanadi (skrinshot ishlamaydi).
  useEffect(() => {
    if (!b) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(b.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 5) load();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [b, load]);
  if (!b) return <Loading />;
  return (
    <Card style={{ alignItems: "center", gap: 14, paddingVertical: 20 }}>
      <Text style={{ color: c.muted, fontWeight: "600", fontSize: 13 }}>{b.company}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, alignSelf: "stretch" }}>
        {b.employee.photoDataUrl ? <Image source={{ uri: mediaUri(b.employee.photoDataUrl) }} style={st.photo} /> : <View style={[st.photo, { backgroundColor: c.tint }]} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{b.employee.name}</Text>
          <Text style={{ color: c.muted }}>{b.employee.position}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {b.employee.branch} · {b.employee.employeeNo}
          </Text>
        </View>
      </View>
      <Image source={{ uri: b.qr }} style={st.qr} />
      <Text style={{ color: c.muted, fontSize: 12.5 }}>QR {left} soniyadan keyin yangilanadi</Text>
    </Card>
  );
}

const st = StyleSheet.create({
  opt: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12 },
  step: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 44, borderRadius: 12 },
  photo: { width: 72, height: 72, borderRadius: 18 },
  qr: { width: 240, height: 240, borderRadius: 16, backgroundColor: "#fff" },
});
