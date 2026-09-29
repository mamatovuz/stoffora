import bcrypt from "bcryptjs";
import type { Attendance, Database, Employee } from "./types";
import { tashkentIsoDate } from "./format";

const id = (prefix: string, index: number) =>
  `${prefix}_${String(index).padStart(3, "0")}`;
const iso = (date: Date) => date.toISOString();

export async function createSeed(): Promise<Database> {
  const now = new Date();
  const today = tashkentIsoDate(now);
  const passwordHash = await bcrypt.hash("Staffora2026!", 12);
  const companyId = "cmp_gulnora";
  const branches = [
    {
      id: "br_andijon",
      companyId,
      name: "Andijon",
      address: "Andijon sh., Bobur shoh ko‘chasi 12",
      latitude: 40.7821,
      longitude: 72.3442,
      radiusMeters: 100,
      manager: "Akmal Rasulov",
      status: "ACTIVE" as const,
      scheduleId: "sch_standard",
    },
    {
      id: "br_asaka",
      companyId,
      name: "Asaka",
      address: "Asaka sh., Amir Temur ko‘chasi 8",
      latitude: 40.6415,
      longitude: 72.2387,
      radiusMeters: 120,
      manager: "Dilshod Karimov",
      status: "ACTIVE" as const,
      scheduleId: "sch_standard",
    },
    {
      id: "br_shahrixon",
      companyId,
      name: "Shahrixon",
      address: "Shahrixon sh., Mustaqillik ko‘chasi 21",
      latitude: 40.7132,
      longitude: 72.0574,
      radiusMeters: 100,
      manager: "Madina Sobirova",
      status: "ACTIVE" as const,
      scheduleId: "sch_flexible",
    },
  ];
  const departments = ["IT", "HR", "Savdo", "Dorixona", "Moliya"].map(
    (name, i) => ({ id: id("dep", i + 1), companyId, name }),
  );
  const positions = [
    "Dasturchi",
    "HR menejer",
    "Savdo menejeri",
    "Farmatsevt",
    "Buxgalter",
  ].map((name, i) => ({
    id: id("pos", i + 1),
    companyId,
    name,
    departmentId: id("dep", i + 1),
  }));
  const schedules = [
    {
      id: "sch_standard",
      companyId,
      name: "Standart 5/2",
      type: "FIXED" as const,
      graceMinutes: 5,
      overtimeEnabled: true,
      days: [1, 2, 3, 4, 5, 6, 0].map((day) => ({
        day,
        enabled: day > 0 && day < 6,
        start: "08:00",
        end: "17:00",
        breakMinutes: 60,
      })),
    },
    {
      id: "sch_flexible",
      companyId,
      name: "Moslashuvchan",
      type: "FLEXIBLE" as const,
      graceMinutes: 10,
      overtimeEnabled: true,
      days: [1, 2, 3, 4, 5, 6, 0].map((day) => ({
        day,
        enabled: day > 0 && day < 7,
        start: "09:00",
        end: "18:00",
        breakMinutes: 60,
      })),
    },
  ];
  const names = [
    ["Ali", "Aliyev"],
    ["Madina", "Sobirova"],
    ["Javohir", "Karimov"],
    ["Dilnoza", "Ergasheva"],
    ["Sardor", "Ismoilov"],
    ["Gulbahor", "To‘xtayeva"],
    ["Akmal", "Rasulov"],
    ["Mohira", "Qodirova"],
    ["Bekzod", "Usmonov"],
    ["Nodira", "Abdullayeva"],
    ["Azizbek", "Hamidov"],
    ["Shahnoza", "Yoqubova"],
    ["Rustam", "Xoliqov"],
    ["Feruza", "Olimova"],
    ["Diyor", "Tursunov"],
    ["Malika", "Vohidova"],
    ["Oybek", "Solijonov"],
    ["Zilola", "Mahmudova"],
    ["Kamron", "Ibrohimov"],
    ["Nigora", "Ahmedova"],
  ];
  const employees: Employee[] = names.map(([firstName, lastName], i) => ({
    id: id("emp", i + 1),
    companyId,
    employeeNo: `GF-${String(i + 1).padStart(4, "0")}`,
    firstName,
    lastName,
    phone: `+998 90 ${String(1200000 + i * 7311).slice(0, 3)} ${String(1200000 + i * 7311).slice(3, 5)} ${String(1200000 + i * 7311).slice(5, 7)}`,
    email: `${firstName.toLowerCase().replace("‘", "")}.${lastName.toLowerCase().replace("‘", "")}@gulnorafarm.uz`,
    address: "Andijon viloyati",
    departmentId: id("dep", (i % 5) + 1),
    positionId: id("pos", (i % 5) + 1),
    branchId: branches[i % 3].id,
    scheduleId: i % 4 === 0 ? "sch_flexible" : "sch_standard",
    manager: i % 3 === 0 ? "Akmal Rasulov" : "Madina Sobirova",
    employmentType: i % 7 === 0 ? "PART_TIME" : "FULL_TIME",
    startDate: `202${2 + (i % 4)}-${String((i % 9) + 1).padStart(2, "0")}-15`,
    baseSalary: 3_500_000 + (i % 5) * 750_000,
    currency: "UZS",
    telegramUsername: i % 3 ? `${firstName.toLowerCase()}_${i + 1}` : undefined,
    telegramId: i === 0 ? "7770001" : undefined,
    telegramConnected: i === 0 || i % 3 !== 0,
    deviceStatus: i % 3 !== 0 ? "CONNECTED" : "PENDING",
    status: i === 19 ? "INACTIVE" : "ACTIVE",
    createdAt: iso(new Date(now.getTime() - (i + 20) * 86400000)),
    updatedAt: iso(now),
  }));
  const attendance: Attendance[] = employees.slice(0, 17).map((employee, i) => {
    const checkIn =
      i < 3
        ? undefined
        : i % 5 === 0
          ? "08:14"
          : i % 4 === 0
            ? "08:07"
            : "07:58";
    const late = checkIn && checkIn > "08:05" ? Number(checkIn.slice(3)) : 0;
    return {
      id: id("att", i + 1),
      companyId,
      employeeId: employee.id,
      branchId: employee.branchId,
      date: today,
      scheduledStart: "08:00",
      scheduledEnd: "17:00",
      checkIn,
      checkOut: i > 13 ? "17:06" : undefined,
      lateMinutes: late,
      earlyLeaveMinutes: 0,
      workedMinutes: i > 13 ? 548 : 0,
      overtimeMinutes: i > 13 ? 6 : 0,
      status: !checkIn
        ? "ABSENT"
        : i > 13
          ? late
            ? "LATE"
            : "CHECKED_OUT"
          : late
            ? "LATE"
            : "WORKING",
      verification: checkIn ? ["GPS", "QR"] : [],
      latitude: checkIn ? branches[i % 3].latitude : undefined,
      longitude: checkIn ? branches[i % 3].longitude : undefined,
      distanceMeters: checkIn ? 12 + i : undefined,
      updatedAt: iso(now),
    };
  });
  return {
    companies: [
      {
        id: companyId,
        name: "Gulnora Farm",
        slug: "gulnora-farm",
        ownerName: "Gulnora Karimova",
        plan: "Business",
        status: "ACTIVE",
        timezone: "Asia/Tashkent",
        createdAt: iso(new Date("2024-03-12")),
      },
      {
        id: "cmp_ziyoda",
        name: "Ziyoda Textile",
        slug: "ziyoda-textile",
        ownerName: "Sardor Nabiyev",
        plan: "Standard",
        status: "TRIAL",
        timezone: "Asia/Tashkent",
        createdAt: iso(new Date("2026-09-12")),
      },
    ],
    branches,
    departments,
    positions,
    schedules,
    employees,
    attendance,
    leaveRequests: [
      {
        id: "leave_001",
        companyId,
        employeeId: "emp_006",
        type: "VACATION",
        startDate: today,
        endDate: today,
        reason: "Oilaviy sabablar",
        status: "APPROVED",
        decidedBy: "Ozodbek Admin",
        createdAt: iso(now),
      },
      {
        id: "leave_002",
        companyId,
        employeeId: "emp_012",
        type: "SICK",
        startDate: today,
        endDate: today,
        reason: "Sog‘liq bilan bog‘liq",
        status: "PENDING",
        createdAt: iso(now),
      },
    ],
    auditLogs: [
      {
        id: "audit_001",
        companyId,
        actor: "Ozodbek Admin",
        action: "Xodim profili yaratildi",
        entity: "employee",
        entityId: "emp_020",
        createdAt: iso(now),
      },
    ],
    announcements: [
      {
        id: "ann_001",
        companyId,
        title: "Umumiy yig‘ilish",
        message:
          "Juma kuni soat 16:00 da markaziy filialda umumiy yig‘ilish bo‘ladi.",
        audience: "Barcha xodimlar",
        channel: ["WEB", "TELEGRAM"],
        scheduledAt: iso(now),
        status: "SENT",
      },
    ],
    notifications: [
      {
        id: "not_001",
        companyId,
        title: "Yangi ta’til so‘rovi",
        body: "Shahnoza Yoqubova kasallik ta’tili so‘radi.",
        type: "LEAVE",
        read: false,
        createdAt: iso(now),
      },
      {
        id: "not_002",
        companyId,
        title: "Kechikish aniqlandi",
        body: "Bugun 3 nafar xodim kechikdi.",
        type: "ATTENDANCE",
        read: false,
        createdAt: iso(now),
      },
    ],
    users: [
      {
        id: "usr_admin",
        companyId,
        name: "Ozodbek Admin",
        email: "admin@staffora.uz",
        passwordHash,
        role: "COMPANY_OWNER",
      },
      {
        id: "usr_super",
        name: "Staffora Super Admin",
        email: "super@staffora.uz",
        passwordHash,
        role: "SUPER_ADMIN",
      },
    ],
    telegramInvites: [],
    attendanceSessions: [],
    qrNonces: [],
    faceProfiles: [],
  };
}
