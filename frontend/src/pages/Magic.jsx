import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, setSession } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

// A link from WhatsApp: logs the student in and opens the test / practice.
export default function Magic() {
  const { token } = useParams();
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/auth/magic', { method: 'POST', body: { token } })
      .then((d) => {
        setSession({ token: d.token, kind: 'student', name: d.student.name, centre: d.student.centre.name, centreId: d.student.centre.id, centreCode: d.student.centre.code });
        window.location.replace(d.path || '/');
      })
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-3">
        <div className="font-display text-xl font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
        {error ? <ErrorNote error={error} /> : <p className="text-sm text-ink-soft">Opening…</p>}
      </div>
    </main>
  );
}
