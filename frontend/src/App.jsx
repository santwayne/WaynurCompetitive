import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { BookOpen, GraduationCap, LayoutGrid, LogOut, Users } from 'lucide-react';
import { getSession, setSession } from './api.js';
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

function Shell({ links, children }) {
  const s = getSession();
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="font-display text-lg font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${isActive ? 'bg-secondary text-ink' : 'text-ink-soft hover:bg-secondary'}`}>
                <Icon size={16} aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-ink-soft">
            <span className="hidden sm:inline">{s?.name} · {s?.centre}</span>
            <button className="btn-ghost px-3 py-1.5" onClick={() => { setSession(null); nav('/login'); }}><LogOut size={15} aria-hidden="true" />Log out</button>
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
];
const STUDENT_LINKS = [{ to: '/', label: 'My tests', icon: GraduationCap }];

export default function App() {
  const s = getSession();
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
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Shell>
  );
}
