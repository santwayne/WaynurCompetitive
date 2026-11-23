import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import centreRoutes from './routes/centre.js';
import syllabusRoutes from './routes/syllabus.js';
import testRoutes from './routes/tests.js';
import studentRoutes from './routes/student.js';
import adminRoutes from './routes/admin.js';
import whatsappRoutes from './routes/whatsapp.js';

// The Express app without listen(), so tests can drive it directly.
export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind nginx: real client IP for the rate limits
  const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : undefined));
  // CSV imports come as JSON strings. rawBody is kept for the WhatsApp
  // webhook signature check (Meta signs the exact bytes).
  app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/whatsapp/')) req.rawBody = buf; } }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/centre', centreRoutes);
  app.use('/api/syllabus', syllabusRoutes);
  app.use('/api/tests', testRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/whatsapp', whatsappRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File too large (max 2 MB)' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
