import { Route, Routes } from 'react-router-dom';
import { AccountPage, AuditPage, InboxRoute, SettingsPage, UsersPage } from './Admin';
import { ContentEdit, ContentList } from './Content';
import { Dashboard } from './Dashboard';
import { PortalLayout } from './PortalLayout';

export default function PortalRoutes() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="content/:entity" element={<ContentList />} />
        <Route path="content/:entity/:id" element={<ContentEdit />} />
        <Route path="inbox/enquiries" element={<InboxRoute kind="enquiries" />} />
        <Route path="inbox/messages" element={<InboxRoute kind="messages" />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
