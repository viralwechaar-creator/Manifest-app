import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './components/States';
import { Home } from './site/Home';
import { SiteLayout } from './site/SiteLayout';
import { AlbumPage, CalendarPage, EventsPage, GalleryPage } from './site/EventsGallery';
import { ContactPage, EnquiryPage, NotFound } from './site/Forms';
import { AchievementsPage, AlumniPage, CareersPage, CurriculumPage, DepartmentsPage, DocumentsPage, FacultyPage, NewsDetail, NewsPage } from './site/Lists';
import { ApplyPage, TrackPage } from './site/Admission';
import { PoliciesPage, PrincipalPage, TextPage, VisionMissionPage } from './site/TextPages';

const Portal = lazy(() => import('./portal/PortalRoutes'));
const Family = lazy(() => import('./family/FamilyRoutes'));
const Login = lazy(() => import('./portal/Login').then((m) => ({ default: m.Login })));

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<Home />} />
          <Route path="about" element={<TextPage slug="about" intro />} />
          <Route path="principal" element={<PrincipalPage />} />
          <Route path="vision-mission" element={<VisionMissionPage />} />
          <Route path="academics" element={<TextPage slug="academics" intro />} />
          <Route path="curriculum" element={<CurriculumPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="faculty" element={<FacultyPage />} />
          <Route path="infrastructure" element={<TextPage slug="infrastructure" />} />
          <Route path="admissions" element={<TextPage slug="admissions" />} />
          <Route path="admissions/enquiry" element={<EnquiryPage />} />
          <Route path="admissions/apply" element={<ApplyPage />} />
          <Route path="admissions/track" element={<TrackPage />} />
          <Route path="gallery" element={<GalleryPage />} />
          <Route path="gallery/:id" element={<AlbumPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="news/:id" element={<NewsDetail />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="transport" element={<TextPage slug="transport" />} />
          <Route path="alumni" element={<AlumniPage />} />
          <Route path="careers" element={<CareersPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="login" element={<Login />} />
        <Route path="portal/*" element={<Portal />} />
        <Route path="family/*" element={<Family />} />
        <Route path="admin" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
