import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Building2, FileText, GraduationCap, LayoutGrid, LogOut, MessageCircle, Users } from 'lucide-react';
import { getSession, setSession } from './api.js';
import { inApp } from './native.js';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Batch from './pages/Batch.jsx';
import NewTest from './pages/NewTest.jsx';
import TestPage from './pages/TestPage.jsx';
import Questions from './pages/Questions.jsx';
import Staff from './pages/Staff.jsx';
import StudentHome from './pages/StudentHome.jsx';
import TakeTest from './pages/TakeTest.jsx';
import Result from './pages/Result.jsx';
import Practice from './pages/Practice.jsx';
import WhatsApp from './pages/WhatsApp.jsx';
import Magic from './pages/Magic.jsx';
import AppStart from './pages/AppStart.jsx';
import AdminLogin from './pages/admin/AdminLogin.jsx';
import AdminHome from './pages/admin/AdminHome.jsx';
import AdminCentre from './pages/admin/AdminCentre.jsx';
import AdminPatterns from './pages/admin/AdminPatterns.jsx';
import AdminTemplates from './pages/admin/AdminTemplates.jsx';

function Shell({ links, children }) {
  const s = getSession();
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="font-display text-lg font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span>{s?.kind === 'super_admin' && <span className="ml-2 rounded bg-ink px-1.5 py-0.5 align-middle text-xs text-card">Super Admin</span>}</div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/' || to === '/admin'} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${isActive ? 'bg-secondary text-ink' : 'text-ink-soft hover:bg-secondary'}`}>
                <Icon size={16} aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-ink-soft">
            <span className="hidden sm:inline">{s?.name} · {s?.centre}</span>
            <button className="btn-ghost px-3 py-1.5" onClick={() => { const admin = s?.kind === 'super_admin'; setSession(null); nav(admin ? '/admin/login' : inApp() ? '/app' : '/login'); }}><LogOut size={15} aria-hidden="true" />Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

const STAFF_LINKS = [
  { to: '/', label: 'Batches', icon: LayoutGrid },
  { to: '/questions', label: 'Question bank', icon: BookOpen },
  { to: '/staff', label: 'Team', icon: Users },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
];
const ADMIN_LINKS = [
  { to: '/admin', label: 'Centres', icon: Building2 },
  { to: '/admin/patterns', label: 'Exam patterns', icon: FileText },
  { to: '/admin/whatsapp', label: 'WhatsApp set-up', icon: MessageCircle },
];
const STUDENT_LINKS = [{ to: '/', label: 'My tests', icon: GraduationCap }];

export default function App() {
  const s = getSession();
  const { pathname } = useLocation();
  // A WhatsApp link logs the student in, whoever was logged in on this phone before.
  if (pathname.startsWith('/go/')) return <Routes><Route path="/go/:token" element={<Magic />} /></Routes>;
  if (pathname === '/app') return <AppStart />;
  if (pathname.startsWith('/admin') && s?.kind !== 'super_admin') {
    return <Routes><Route path="*" element={<AdminLogin />} /></Routes>;
  }
  if (s?.kind === 'super_admin') {
    return (
      <Shell links={ADMIN_LINKS}>
        <Routes>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/centres/:id" element={<AdminCentre />} />
          <Route path="/admin/patterns" element={<AdminPatterns />} />
          <Route path="/admin/whatsapp" element={<AdminTemplates />} />
          <Route path="*" element={<Navigate to="/admin" />} />
        </Routes>
      </Shell>
    );
  }
  if (!s) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/s/:centreId" element={<Login student />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (s.kind === 'student') {
    return (
      <Shell links={STUDENT_LINKS}>
        <Routes>
          <Route path="/" element={<StudentHome />} />
          <Route path="/test/:id" element={<TakeTest />} />
          <Route path="/result/:id" element={<Result />} />
          <Route path="/practice/:id" element={<Practice />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Shell>
    );
  }
  return (
    <Shell links={STAFF_LINKS}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/batch/:id" element={<Batch />} />
        <Route path="/batch/:id/new-test" element={<NewTest />} />
        <Route path="/tests/:id" element={<TestPage />} />
        <Route path="/questions" element={<Questions />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Shell>
  );
}
