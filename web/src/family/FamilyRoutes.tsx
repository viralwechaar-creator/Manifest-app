import { Route, Routes } from 'react-router-dom';
import { AccountPage } from '../portal/Admin';
import { FamilyAttendance, FamilyFees, FamilyHome, FamilyHomework, FamilyLayout, FamilyLeave, FamilyMore, FamilyNotices, FamilyRemarks, FamilyResults, FamilyTimetable } from './Family';

export default function FamilyRoutes() {
  return (
    <Routes>
      <Route element={<FamilyLayout />}>
        <Route index element={<FamilyHome />} />
        <Route path="attendance" element={<FamilyAttendance />} />
        <Route path="results" element={<FamilyResults />} />
        <Route path="homework" element={<FamilyHomework />} />
        <Route path="fees" element={<FamilyFees />} />
        <Route path="more" element={<FamilyMore />} />
        <Route path="timetable" element={<FamilyTimetable />} />
        <Route path="remarks" element={<FamilyRemarks />} />
        <Route path="notices" element={<FamilyNotices />} />
        <Route path="leave" element={<FamilyLeave />} />
        <Route path="account" element={<div className="stack"><AccountPage /></div>} />
      </Route>
    </Routes>
  );
}
