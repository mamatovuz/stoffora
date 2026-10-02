import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Protected } from "./auth";
import { Shell } from "./components/Shell";
const LoginPage = lazy(() =>
  import("./pages/Login").then((m) => ({ default: m.LoginPage })),
);
const SetupPage = lazy(() =>
  import("./pages/Login").then((m) => ({ default: m.SetupPage })),
);
const UsersPage = lazy(() =>
  import("./pages/Directory").then((m) => ({ default: m.UsersPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })),
);
const EmployeesPage = lazy(() =>
  import("./pages/Employees").then((m) => ({ default: m.EmployeesPage })),
);
const EmployeeFormPage = lazy(() =>
  import("./pages/Employees").then((m) => ({ default: m.EmployeeFormPage })),
);
const DismissedPage = lazy(() =>
  import("./pages/Employees").then((m) => ({ default: m.DismissedPage })),
);
const EmployeeProfilePage = lazy(() =>
  import("./pages/Employees").then((m) => ({ default: m.EmployeeProfilePage })),
);
const AttendancePage = lazy(() =>
  import("./pages/Attendance").then((m) => ({ default: m.AttendancePage })),
);
const BranchesPage = lazy(() =>
  import("./pages/Branches").then((m) => ({ default: m.BranchesPage })),
);
const SchedulesPage = lazy(() =>
  import("./pages/Schedules").then((m) => ({ default: m.SchedulesPage })),
);
const LeavePage = lazy(() =>
  import("./pages/Leave").then((m) => ({ default: m.LeavePage })),
);
const PayrollPage = lazy(() =>
  import("./pages/Finance").then((m) => ({ default: m.PayrollPage })),
);
const ReportsPage = lazy(() =>
  import("./pages/Finance").then((m) => ({ default: m.ReportsPage })),
);
const AnnouncementsPage = lazy(() =>
  import("./pages/Communication").then((m) => ({
    default: m.AnnouncementsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("./pages/Communication").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AttendanceRequestsPage = lazy(() =>
  import("./pages/AttendanceRequests").then((m) => ({ default: m.AttendanceRequestsPage })),
);
const AdvancesPage = lazy(() => import("./pages/Money").then((m) => ({ default: m.AdvancesPage })));
const FinancePage = lazy(() => import("./pages/Money").then((m) => ({ default: m.FinancePage })));
const RewardsPage = lazy(() => import("./pages/Money").then((m) => ({ default: m.RewardsPage })));
const FinesPage = lazy(() => import("./pages/Money").then((m) => ({ default: m.FinesPage })));
const AuditPage = lazy(() =>
  import("./pages/Communication").then((m) => ({ default: m.AuditPage })),
);
const DirectoryPage = lazy(() =>
  import("./pages/Directory").then((m) => ({ default: m.DirectoryPage })),
);
const RolesPage = lazy(() =>
  import("./pages/Directory").then((m) => ({ default: m.RolesPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.SettingsPage })),
);
const CalendarPage = lazy(() =>
  import("./pages/Calendar").then((m) => ({ default: m.CalendarPage })),
);
const QrScreen = lazy(() =>
  import("./pages/QrScreen").then((m) => ({ default: m.QrScreen })),
);
const SuperAdminPage = lazy(() =>
  import("./pages/SuperAdmin").then((m) => ({ default: m.SuperAdminPage })),
);
const AnalyticsPage = lazy(() =>
  import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })),
);
const RegistrationsPage = lazy(() =>
  import("./pages/Registrations").then((m) => ({ default: m.RegistrationsPage })),
);
const MapPage = lazy(() => import("./pages/MapPage").then((m) => ({ default: m.MapPage })));
const HelpdeskPage = lazy(() =>
  import("./pages/Helpdesk").then((m) => ({ default: m.HelpdeskPage })),
);
const MiniAppPage = lazy(() =>
  import("./pages/MiniApp").then((m) => ({ default: m.MiniAppPage })),
);

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="screen-loader">
          <span />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/mini-app" element={<MiniAppPage />} />
        <Route
          path="/attendance-screen/:branchId"
          element={
            <Protected>
              <QrScreen />
            </Protected>
          }
        />
        <Route
          path="/super-admin"
          element={
            <Protected superAdmin>
              <SuperAdminPage />
            </Protected>
          }
        />
        <Route
          element={
            <Protected>
              <Shell />
            </Protected>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employees/new" element={<EmployeeFormPage />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage />} />
          <Route path="/dismissed" element={<DismissedPage />} />
          <Route path="/registrations" element={<RegistrationsPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/branches" element={<BranchesPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/leave" element={<LeavePage />} />
          <Route path="/attendance-requests" element={<AttendanceRequestsPage />} />
          <Route path="/helpdesk" element={<HelpdeskPage />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/advances" element={<AdvancesPage />} />
          <Route path="/fines" element={<FinesPage />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route
            path="/departments"
            element={<DirectoryPage type="departments" />}
          />
          <Route
            path="/positions"
            element={<DirectoryPage type="positions" />}
          />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
