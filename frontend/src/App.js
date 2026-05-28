import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import UserManagement from "@/pages/UserManagement";
import Schools from "@/pages/Schools";
import Teachers from "@/pages/Teachers";
import Supervisors from "@/pages/Supervisors";
import Principals from "@/pages/Principals";
import Permissions from "@/pages/Permissions";
import Profile from "@/pages/Profile";
import AcademicYears from "@/pages/AcademicYears";
import Semesters from "@/pages/Semesters";
import AssessmentPeriods from "@/pages/AssessmentPeriods";
import ObservationCategories from "@/pages/ObservationCategories";
import ObservationAspects from "@/pages/ObservationAspects";
import Assignments from "@/pages/Assignments";
import MyAssessment from "@/pages/MyAssessment";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/profil" element={<ProtectedRoute roles={["guru"]}><Profile /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute roles={["admin"]}><UserManagement /></ProtectedRoute>} />
              <Route path="/sekolah" element={<ProtectedRoute roles={["admin", "pengawas", "kepala_sekolah"]}><Schools /></ProtectedRoute>} />
              <Route path="/guru" element={<ProtectedRoute roles={["admin", "pengawas", "kepala_sekolah"]}><Teachers /></ProtectedRoute>} />
              <Route path="/pengawas" element={<ProtectedRoute roles={["admin"]}><Supervisors /></ProtectedRoute>} />
              <Route path="/kepala-sekolah" element={<ProtectedRoute roles={["admin"]}><Principals /></ProtectedRoute>} />
              <Route path="/permissions" element={<ProtectedRoute roles={["admin"]}><Permissions /></ProtectedRoute>} />
              <Route path="/tahun-ajaran" element={<ProtectedRoute roles={["admin"]}><AcademicYears /></ProtectedRoute>} />
              <Route path="/semester" element={<ProtectedRoute roles={["admin"]}><Semesters /></ProtectedRoute>} />
              <Route path="/periode-penilaian" element={<ProtectedRoute roles={["admin", "pengawas", "kepala_sekolah", "guru"]}><AssessmentPeriods /></ProtectedRoute>} />
              <Route path="/komponen-observasi" element={<ProtectedRoute roles={["admin", "pengawas", "kepala_sekolah", "guru"]}><ObservationCategories /></ProtectedRoute>} />
              <Route path="/aspek-penilaian" element={<ProtectedRoute roles={["admin"]}><ObservationAspects /></ProtectedRoute>} />
              <Route path="/assignments" element={<ProtectedRoute roles={["admin", "pengawas", "kepala_sekolah"]}><Assignments /></ProtectedRoute>} />
              <Route path="/penilaian-saya" element={<ProtectedRoute roles={["guru"]}><MyAssessment /></ProtectedRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
