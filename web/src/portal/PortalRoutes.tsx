import { Route, Routes } from 'react-router-dom';
import { AccountPage, AuditPage, InboxRoute, SettingsPage, UsersPage } from './Admin';
import { ContentEdit, ContentList } from './Content';
import { Dashboard } from './Dashboard';
import { PortalLayout } from './PortalLayout';
import { AcademicsPage } from './Academics';
import { AttendancePage } from './Attendance';
import { ExamDetail, ExamsList, HomeworkPage, ReportCard } from './Exams';
import { LeavePage, SubstitutionsPage } from './Leave';
import { TimetablePage } from './Timetable';
import { StaffDetail, StaffForm, StaffList } from './Staff';
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
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
