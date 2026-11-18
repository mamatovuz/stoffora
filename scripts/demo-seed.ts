/*
 * Faqat lokal dizayn sinovi va landing skrinshotlari uchun demo baza: SQLITE_PATH’ga alohida fayl bering.
 *   SQLITE_PATH=./data/demo.sqlite BOOTSTRAP_... npx tsx scripts/demo-seed.ts
 * Ishlab chiqarish bazasida ishga tushirmang. Ma’lumotlar to‘qima (namuna) — real shaxslar emas.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { readDb, updateDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import { defaultPlans } from "../lib/platform/subscriptions";
import { CORPORATE_TENANT, type CorporateTransaction } from "../lib/corporate/types";
import { postLedger } from "../server/corporate/ledger";
import { freezeMonth, setStage } from "../server/payroll-workflow";
import type { Attendance, Database } from "../lib/types";

if (!process.env.SQLITE_PATH || /staffora\.sqlite$/.test(process.env.SQLITE_PATH)) {
  console.error("SQLITE_PATH alohida demo fayl bo‘lishi kerak.");
  process.exit(1);
}

const id = () => randomUUID();
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const iso = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`).toISOString();
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const PEOPLE: [string, string, number, number][] = [
  // ism, familiya, lavozim indeksi, filial indeksi
  ["Xurshidbek", "Abdullayev", 0, 0], ["Maria", "Gonzalez", 1, 0], ["Lina", "Smith", 2, 1], ["Dilnoza", "Karimova", 3, 0],
  ["Jasur", "Toshmatov", 4, 1], ["Madina", "Rahimova", 5, 0], ["Sardor", "Aliyev", 6, 2], ["Nodira", "Yusupova", 7, 2],
  ["Bekzod", "Ergashev", 4, 3], ["Gulnora", "Saidova", 5, 3], ["Otabek", "Nurmatov", 2, 0], ["Shahzoda", "Qodirova", 0, 1],
  ["Azizbek", "Xolmatov", 6, 2], ["Malika", "Tursunova", 7, 0], ["Sherzod", "Rasulov", 4, 1], ["Zarina", "Mirzayeva", 3, 3],
  ["Javohir", "Sobirov", 2, 0], ["Kamola", "Ismoilova", 1, 2], ["Doniyor", "Hamidov", 6, 3], ["Feruza", "Abdurahmonova", 5, 1],
  ["Ulug‘bek", "Sultonov", 4, 0], ["Nilufar", "Bakirova", 7, 2], ["Rustam", "Jo‘rayev", 6, 0], ["Sevara", "Nazarova", 3, 1],
  ["Temur", "Usmonov", 2, 3], ["Laylo", "Karimova", 0, 0], ["Islom", "Raximov", 4, 2], ["Munisa", "Olimova", 7, 3],
  ["Akmal", "Yo‘ldoshev", 6, 1], ["Dildora", "Ahmedova", 5, 0], ["Bobur", "Qosimov", 4, 0], ["Sabina", "Xasanova", 3, 2],
  ["Eldor", "Murodov", 6, 3], ["Nargiza", "Salimova", 7, 1], ["Farrux", "Abdug‘aniyev", 2, 0], ["Ziyoda", "Mahmudova", 1, 3],
  ["Mirjalol", "Komilov", 4, 1], ["Oydin", "Rajabova", 5, 2], ["Shoxrux", "Valiyev", 6, 0], ["Hulkar", "To‘xtayeva", 7, 0],
  ["Asadbek", "Normatov", 4, 3], ["Yulduz", "Saidaliyeva", 3, 0],
];
const POSITIONS: [string, number][] = [
  ["UI/UX dizayner", 0], ["HR menejer", 2], ["Backend dasturchi", 0], ["Frontend dasturchi", 0],
  ["Sotuv menejeri", 3], ["Buxgalter", 4], ["Operator", 3], ["Marketolog", 1],
];

async function main() {
  const before = await readDb();
  const company = before.companies[0];
  if (!company) throw new Error("Avval BOOTSTRAP_* bilan kompaniya yarating.");
  if (before.employees.length) {
    console.log("Demo ma’lumot allaqachon bor.");
    return;
  }
  const today = tashkentIsoDate();
  const ym = today.slice(0, 7);
  const monthStart = `${ym}-01`;
  // Davomat tarixi o‘tgan oy boshidan — yopilgan oy va to‘lovlar namunasi uchun.
  const historyFrom = (() => {
    const d = new Date(`${monthStart}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const e0Start = (i: number) => (i % 11 === 5 ? addDays(monthStart, 9) : historyFrom);
  await updateDb((db: Database) => {
    const c = company.id;
    const now = new Date().toISOString();
    const office = id();
    const shift = id();
    db.schedules.push(
      {
        id: office,
        companyId: c,
        name: "Ofis 09:00–18:00",
        type: "FIXED",
        graceMinutes: 5,
        overtimeEnabled: true,
        days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day !== 0, start: "09:00", end: "18:00", breakMinutes: 60 })),
      } as Database["schedules"][number],
      {
        id: shift,
        companyId: c,
        name: "Smena 08:00–17:00",
        type: "SHIFT",
        graceMinutes: 10,
        overtimeEnabled: true,
        days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day !== 0, start: "08:00", end: "17:00", breakMinutes: 60 })),
      } as Database["schedules"][number],
    );
    const branchRows = [
      ["Bosh ofis", "Toshkent, Amir Temur ko‘chasi 108", 41.3111, 69.2797, office],
      ["Chilonzor filiali", "Toshkent, Chilonzor 9-kvartal", 41.2856, 69.2034, shift],
      ["Samarqand filiali", "Samarqand, Registon ko‘chasi 12", 39.6542, 66.9597, office],
      ["Andijon filiali", "Andijon, Navoiy shoh ko‘chasi 45", 40.7821, 72.3442, shift],
    ] as const;
    const branches = branchRows.map(([name, address, latitude, longitude, scheduleId]) => ({
      id: id(),
      companyId: c,
      name,
      address,
      latitude,
      longitude,
      radiusMeters: 150,
      manager: "",
      status: "ACTIVE" as const,
      scheduleId,
      attendanceMode: "GPS_FACE" as const,
    }));
    db.branches.push(...(branches as unknown as Database["branches"]));
    const departments = ["Engineering", "Marketing", "Kadrlar bo‘limi", "Savdo", "Moliya"].map((name) => ({ id: id(), companyId: c, name, manager: "" }));
    db.departments.push(...(departments as unknown as Database["departments"]));
    const positions = POSITIONS.map(([name, dep]) => ({ id: id(), companyId: c, name, departmentId: departments[dep].id }));
    db.positions.push(...(positions as unknown as Database["positions"]));

    PEOPLE.forEach(([firstName, lastName, pos, br], i) => {
      const employeeId = id();
      const branch = branches[br];
      const scheduleId = branch.scheduleId;
      const start = scheduleId === office ? 9 * 60 : 8 * 60;
      const end = start + 9 * 60;
      db.employees.push({
        id: employeeId,
        companyId: c,
        employeeNo: `E-${1001 + i}`,
        firstName,
        lastName,
        phone: `+998 90 ${pad(10 + i)} ${pad((i * 7) % 100)} ${pad((i * 13) % 100)}`,
        email: "",
        branchId: branch.id,
        departmentId: positions[pos].departmentId,
        positionId: positions[pos].id,
        scheduleId,
        employmentType: "FULL_TIME",
        status: "ACTIVE",
        baseSalary: 4_500_000 + (i % 9) * 500_000,
        currency: "UZS",
        startDate: i % 11 === 5 ? addDays(monthStart, 9) : `${Number(ym.slice(0, 4)) - 1}-0${(i % 9) + 1}-01`,
        telegramId: `dev-${i}`,
        telegramConnected: true,
        deviceStatus: "CONNECTED",
        faceEnrolledAt: now,
        birthDate: `199${i % 10}-0${(i % 9) + 1}-1${i % 10}`,
        createdAt: now,
        updatedAt: now,
      } as unknown as Database["employees"][number]);

      // Oy boshidan bugungacha davomat (bugun — jonli holatlar aralash).
      for (let date = historyFrom; date <= today; date = addDays(date, 1)) {
        if (date < e0Start(i)) continue;
        if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) continue;
        const d = Number(date.slice(8));
        const isToday = date === today;
        if (isToday && i % 13 === 4) continue; // bugun kelmagan
        if (isToday && i % 17 === 9) continue; // ta’tilda (pastda)
        if (!isToday && (d + i) % 11 === 0) continue; // ba’zan kelmagan
        const late = (isToday ? i % 7 === 2 : (d + i * 5) % 9 === 0) ? 6 + ((d + i) % 34) : 0;
        const inMin = start + late - (late ? 0 : (d + i) % 9);
        const outMin = end + ((d * (i + 1)) % 47) - (i % 10 === 3 ? 25 : 0);
        const stillIn = isToday && i % 4 === 1;
        const checkOut = stillIn ? undefined : hm(outMin);
        const worked = stillIn ? 0 : outMin - inMin - 60;
        db.attendance.push({
          id: id(),
          companyId: c,
          employeeId,
          branchId: branch.id,
          date,
          scheduledStart: hm(start),
          scheduledEnd: hm(end),
          checkIn: hm(inMin),
          checkOut,
          lateMinutes: late > 5 ? late : 0,
          earlyLeaveMinutes: !stillIn && outMin < end ? end - outMin : 0,
          workedMinutes: Math.max(0, worked),
          overtimeMinutes: stillIn ? 0 : Math.max(0, outMin - end),
          status: late > 5 ? "LATE" : "PRESENT",
          verification: i % 5 === 0 ? ["QR", "GPS"] : i % 3 === 0 ? ["DEVICE"] : ["FACE", "GPS"],
          latitude: branch.latitude,
          longitude: branch.longitude,
          source: "STAFFORA",
          updatedAt: iso(date, checkOut || hm(inMin)),
        } as Attendance);
      }
    });

    const emp = (index: number) => db.employees.filter((e) => e.companyId === c)[index];
    // Ta’til arizalari: kutilayotgan, tasdiqlangan va rad etilgan.
    const leave = (
      index: number,
      type: Database["leaveRequests"][number]["type"],
      from: number,
      to: number,
      reason: string,
      status: Database["leaveRequests"][number]["status"],
      hoursAgo: number,
    ) =>
      db.leaveRequests.push({
        id: id(),
        companyId: c,
        employeeId: emp(index).id,
        type,
        startDate: addDays(today, from),
        endDate: addDays(today, to),
        reason,
        status,
        decidedBy: status === "PENDING" ? undefined : company.ownerName,
        createdAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
      } as Database["leaveRequests"][number]);
    leave(0, "OTHER", 3, 7, "O‘quv ta’tili — magistratura sessiyasi", "PENDING", 3);
    leave(2, "VACATION", 10, 23, "Yillik mehnat ta’tili", "PENDING", 20);
    leave(9, "VACATION", 0, 4, "Oilaviy sabab", "APPROVED", 40);
    leave(26, "VACATION", -1, 3, "Yillik mehnat ta’tili", "APPROVED", 70);
    leave(5, "SICK", -3, -1, "Shamollash, shifokor ma’lumotnomasi bor", "APPROVED", 90);
    leave(14, "PERMISSION", 1, 1, "Shaxsiy ish", "REJECTED", 30);
    // Belgilash (ish vaqtini o‘zgartirish) so‘rovlari.
    for (const [index, kind, time, comment] of [
      [1, "IN", "08:52", "Ish vaqtini o‘zgartirish — telefon zaryadi tugagan edi"],
      [17, "OUT", "18:40", "Mijoz bilan uchrashuv cho‘zildi"],
    ] as const)
      db.attendanceCorrections.push({
        id: id(),
        companyId: c,
        employeeId: emp(index).id,
        date: addDays(today, -1),
        time,
        kind,
        branchId: emp(index).branchId,
        comment,
        status: "PENDING",
        createdAt: new Date(Date.now() - 5_400_000).toISOString(),
        updatedAt: now,
      });
    db.notifications.unshift(
      { id: id(), companyId: c, title: "Yangi ta’til arizasi", body: `${emp(2).firstName} ${emp(2).lastName} — yillik ta’til so‘radi`, type: "LEAVE", read: false, createdAt: new Date(Date.now() - 3_600_000).toISOString() },
      { id: id(), companyId: c, title: "Belgilash so‘rovi", body: `${emp(1).firstName} ${emp(1).lastName} — kirish vaqtini tuzatish`, type: "ATTENDANCE_REQUEST", read: false, createdAt: new Date(Date.now() - 5_400_000).toISOString() },
      { id: id(), companyId: c, title: "Ta’til tasdiqlandi", body: `${emp(9).firstName} ${emp(9).lastName} — ${company.ownerName} tasdiqladi`, type: "LEAVE_APPROVED", read: true, createdAt: new Date(Date.now() - 7_200_000).toISOString() },
    );
  });
  await seedPayroll(company.id, today);
  await seedPlatform(company.id, today);
  console.log(`Demo ma’lumot yaratildi: ${PEOPLE.length} xodim, 4 filial, platforma va corporate namunasi.`);
}

/** Ish haqi moduli namunasi: aralash to‘lov turlari, ishbay natijalar, yopilgan o‘tgan oy va qisman to‘lovlar. */
async function seedPayroll(companyId: string, today: string) {
  await updateDb((db: Database) => {
    const now = new Date().toISOString();
    const prev = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const prevMonth = prev.toISOString().slice(0, 7);
    const staff = db.employees.filter((e) => e.companyId === companyId);
    staff.forEach((e, i) => {
      const [payType, rate] = i % 9 === 4 ? (["PIECE", 0] as const) : i % 6 === 1 ? (["DAILY", 180_000 + (i % 3) * 20_000] as const) : i % 6 === 3 ? (["HOURLY", 25_000 + (i % 4) * 2_500] as const) : (["MONTHLY", e.baseSalary] as const);
      db.payRates.push({ id: id(), companyId, employeeId: e.id, payType, rate, currency: "UZS", effectiveFrom: `${prevMonth}-01`, createdAt: now, createdBy: "Demo" });
      if (payType === "PIECE")
        for (let k = 0; k < 4; k += 1)
          db.pieceWorkEntries.push({
            id: id(),
            companyId,
            employeeId: e.id,
            date: addDays(today, -(k * 3 + 1)),
            workType: ["Qadoqlash", "Yig‘ish", "Yetkazib berish", "Montaj"][k],
            unit: k === 2 ? "buyurtma" : "dona",
            quantity: 40 + k * 15,
            unitPrice: k === 2 ? 15_000 : 5_000,
            amount: (40 + k * 15) * (k === 2 ? 15_000 : 5_000),
            status: k === 3 ? "PENDING" : "APPROVED",
            createdAt: now,
            createdBy: "Demo",
            decidedAt: k === 3 ? undefined : now,
            decidedBy: k === 3 ? undefined : "Ozodbek Mamatov",
          });
    });
    // O‘tgan oy: tasdiqlangan va muzlatilgan; bir qismiga to‘lov qayd etilgan.
    const period = freezeMonth(db, companyId, prevMonth, "Ozodbek Mamatov");
    setStage(db, companyId, prevMonth, "APPROVED", "Ozodbek Mamatov");
    period.lines.forEach((line, i) => {
      if (!line.net || i % 4 === 3) return;
      const amount = i % 4 === 2 ? Math.round(line.net / 2) : line.net;
      db.payrollPayments.push({ id: id(), companyId, employeeId: line.employeeId, month: prevMonth, amount, method: i % 3 ? "CARD" : "BANK", paidAt: `${today.slice(0, 7)}-05`, idempotencyKey: id(), createdAt: now, createdBy: "Ozodbek Mamatov" });
    });
  });
}

/** Corporate portal uchun: qo‘shimcha mijoz kompaniyalar, obunalar, to‘lovlar va ta’sischilar (40/40/20). */
async function seedPlatform(mainCompanyId: string, today: string) {
  const passwordHash = await bcrypt.hash("DemoFounder2026!", 10);
  await updateDb((db: Database) => {
    const now = new Date().toISOString();
    if (!db.subscriptionPlans.length) db.subscriptionPlans.push(...defaultPlans(now, id));
    const price: Record<string, number> = { free: 0, pro: 990_000, enterprise: 2_900_000 };
    for (const plan of db.subscriptionPlans) if (plan.key in price) plan.price = plan.key === "free" ? null : price[plan.key];
    const planOf = (key: string) => db.subscriptionPlans.find((p) => p.key === key)!;
    const months = (back: number) => {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - back);
      return d.toISOString().slice(0, 10);
    };
    const clients: [string, number, string, number][] = [
      ["Gulnora Farm", 11, "enterprise", 42],
      ["Sharq Logistika", 10, "pro", 64],
      ["Toshkent Textile", 9, "enterprise", 180],
      ["Navro‘z Market", 7, "pro", 38],
      ["Samarqand Ceramics", 6, "pro", 55],
      ["Andijon Agro", 5, "enterprise", 120],
      ["Buxoro Hotel Group", 3, "pro", 46],
      ["Farg‘ona Med", 2, "pro", 29],
      ["Xiva Travel", 1, "free", 9],
      ["Qarshi Auto", 0, "pro", 21],
    ];
    for (const [name, back, planKey, staff] of clients) {
      const createdAt = new Date(`${months(back).slice(0, 8)}${pad(3 + (back % 20))}T09:00:00Z`).toISOString();
      const plan = planOf(planKey);
      let company = name === "Gulnora Farm" ? db.companies.find((c) => c.id === mainCompanyId) : undefined;
      if (!company) {
        company = { id: id(), name, slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), ownerName: "Demo", plan: plan.name, status: "ACTIVE", timezone: "Asia/Tashkent", createdAt } as Database["companies"][number];
        db.companies.push(company);
        for (let i = 0; i < staff; i += 1)
          db.employees.push({
            id: id(),
            companyId: company.id,
            employeeNo: `C-${i + 1}`,
            firstName: "Xodim",
            lastName: String(i + 1),
            phone: "",
            email: "",
            branchId: "",
            departmentId: "",
            positionId: "",
            scheduleId: "",
            employmentType: "FULL_TIME",
            status: "ACTIVE",
            baseSalary: 0,
            currency: "UZS",
            startDate: addDays(createdAt.slice(0, 10), Math.floor((i / staff) * Math.max(20, back * 28))),
            telegramConnected: false,
            deviceStatus: "PENDING",
            createdAt,
            updatedAt: now,
          } as unknown as Database["employees"][number]);
      }
      company.createdAt = createdAt;
      company.plan = plan.name;
      company.subscription = { planId: plan.id, status: "ACTIVE", startedAt: createdAt, endsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), graceDays: 3, updatedAt: now, free: planKey === "free" };
      if (planKey === "free") continue;
      for (let m = back; m >= 0; m -= 1)
        db.billingRecords.push({
          id: id(),
          number: `INV-${months(m).slice(0, 7)}-${pad(db.billingRecords.length + 1)}`,
          companyId: company.id,
          planId: plan.id,
          planName: plan.name,
          periodStart: months(m),
          periodEnd: addDays(months(m - 1), -1),
          amount: plan.price || 0,
          currency: "UZS",
          status: m === 0 && back % 2 ? "ISSUED" : "PAID",
          paidAt: m === 0 && back % 2 ? undefined : `${months(m).slice(0, 8)}05T10:00:00.000Z`,
          paymentReference: `DEMO-${m}`,
          history: [],
          createdAt: `${months(m).slice(0, 8)}01T09:00:00.000Z`,
          createdBy: "Demo",
          updatedAt: now,
        } as Database["billingRecords"][number]);
    }

    // Corporate: Staffora ta’sischilari (iqtisodiy manfaat 40/40, qolgani — Development Reserve).
    const people = [
      { firstName: "Ozodbek", lastName: "Mamatov", login: "founder.ozodbek", role: "FOUNDER" as const, shareBps: 4000 },
      { firstName: "Sobirjon", lastName: "Musayev", login: "cofounder.sobirjon", role: "CO_FOUNDER" as const, shareBps: 4000 },
      { firstName: "Aziz", lastName: "Karimov", login: "investor.aziz", role: "INVESTOR" as const, shareBps: 0 },
    ].map((p) => ({ id: id(), companyId: CORPORATE_TENANT, name: `${p.firstName} ${p.lastName}`, ...p, passwordHash, status: "ACTIVE" as const, joinedAt: now }));
    db.corporateParticipants.push(...people);
    db.economicInterestVersions.push({
      id: id(),
      companyId: CORPORATE_TENANT,
      version: 1,
      title: "Boshlang‘ich kelishuv loyihasi",
      status: "DRAFT",
      allocations: [
        ...people.filter((p) => p.shareBps).map((p) => ({ id: id(), participantId: p.id, subject: p.name, kind: "PARTICIPANT" as const, shareBps: p.shareBps })),
        { id: id(), subject: "Staffora Development Reserve", kind: "RESERVE" as const, shareBps: 2000 },
      ],
      createdAt: now,
      createdBy: "Demo",
    });
    const tx = (type: CorporateTransaction["type"], category: string, amount: number, description: string, occurredAt: string) => {
      const row: CorporateTransaction = { id: id(), companyId: CORPORATE_TENANT, idempotencyKey: id(), type, category, amountMinor: amount * 100, currency: "UZS", description, occurredAt, status: "DRAFT", createdAt: now, createdBy: "Demo" };
      db.corporateTransactions.push(row);
      postLedger(db, row);
    };
    tx("INVESTMENT", "Boshlang‘ich investitsiya", 150_000_000, "Ta’sischilar badali", `${months(11).slice(0, 8)}02T10:00:00.000Z`);
    for (let m = 11; m >= 0; m -= 1) {
      const income = db.billingRecords.filter((r) => r.status === "PAID" && r.periodStart === months(m)).reduce((s, r) => s + r.amount, 0);
      if (income) tx("INCOME", "Obuna to‘lovlari", income, `${months(m).slice(0, 7)} — mijozlar obunasi`, `${months(m).slice(0, 8)}06T10:00:00.000Z`);
      tx("EXPENSE", "Server va infratuzilma", 2_400_000, "Railway, saqlash va zaxira", `${months(m).slice(0, 8)}10T10:00:00.000Z`);
      if (m % 3 === 0) tx("EXPENSE", "Marketing", 6_500_000, "Reklama va ko‘rgazma", `${months(m).slice(0, 8)}15T10:00:00.000Z`);
    }
  });
}
void main();
