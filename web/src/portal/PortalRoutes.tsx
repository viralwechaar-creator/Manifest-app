import { Route, Routes } from 'react-router-dom';
import { AccountPage, AuditPage, InboxRoute, SettingsPage, UsersPage } from './Admin';
import { ContentEdit, ContentList } from './Content';
import { Dashboard } from './Dashboard';
import { PortalLayout } from './PortalLayout';
import { ComplaintsPage, MessagesPage } from './Comm';
import { HRPage, MyPayPage } from './HR';
import { LibraryPage, TransportPage } from './Operations';
import { AdmissionDetail, AdmissionsList } from './Admissions';
import { FinancePage } from './Finance';
import { NoticesPage, StudentLeavePage } from './Communication';
import { AcademicsPage } from './Academics';
import { AttendancePage } from './Attendance';
import { ExamDetail, ExamsList, HomeworkPage, ReportCard } from './Exams';
import { LeavePage, SubstitutionsPage } from './Leave';
import { TimetablePage } from './Timetable';
import { StaffDetail, StaffForm, StaffList } from './Staff';
import { GatePage, IncidentsPage, PickupsPage } from './Safety';
import { MeetingsPage, PlansPage, SubmissionsPage, SupportPage } from './Teaching2';
import { DeliveryPage, ReportsPage } from './Reports';
import { StudentDetail, StudentForm, StudentsList } from './Students';

export default function PortalRoutes() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="content/:entity" element={<ContentList />} />
        <Route path="content/:entity/:id" element={<ContentEdit />} />
        <Route path="inbox/enquiries" element={<InboxRoute kind="enquiries" />} />
        <Route path="inbox/messages" element={<InboxRoute kind="messages" />} />
        <Route path="students" element={<StudentsList />} />
        <Route path="students/new" element={<StudentForm />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="students/:id/edit" element={<StudentForm />} />
        <Route path="staff" element={<StaffList />} />
        <Route path="staff/new" element={<StaffForm />} />
        <Route path="staff/:id" element={<StaffDetail />} />
        <Route path="academics" element={<AcademicsPage />} />
        <Route path="timetable" element={<TimetablePage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="substitutions" element={<SubstitutionsPage />} />
        <Route path="exams" element={<ExamsList />} />
        <Route path="exams/:id" element={<ExamDetail />} />
        <Route path="report/:studentId" element={<ReportCard />} />
        <Route path="homework" element={<HomeworkPage />} />
        <Route path="homework/:id" element={<SubmissionsPage />} />
        <Route path="lessons" element={<PlansPage />} />
        <Route path="meetings" element={<MeetingsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="safety/gate" element={<GatePage />} />
        <Route path="safety/pickups" element={<PickupsPage />} />
        <Route path="safety/incidents" element={<IncidentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="delivery" element={<DeliveryPage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="student-leave" element={<StudentLeavePage />} />
        <Route path="admissions" element={<AdmissionsList />} />
        <Route path="admissions/:id" element={<AdmissionDetail />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="finance/:tab" element={<FinancePage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="transport" element={<TransportPage />} />
        <Route path="transport/:tab" element={<TransportPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="library/:tab" element={<LibraryPage />} />
        <Route path="hr" element={<HRPage />} />
        <Route path="hr/:tab" element={<HRPage />} />
        <Route path="my/payslips" element={<MyPayPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
