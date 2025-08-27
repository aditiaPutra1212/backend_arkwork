import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import http from 'node:http';

// Routers (perhatikan mana default dan mana named)
import authRouter from './routes/auth';
import newsRouter from './routes/news';
import chatRouter from './routes/chat';
import adminRouter from './routes/admin';
import { employerRouter } from './routes/employer'; // <-- ini memang named
import employerAuthRouter from './routes/employer-auth';
import adminPlansRouter from './routes/admin-plans';
import paymentsRouter from './routes/payments';
import tendersRouter from './routes/tenders';
import adminTendersRouter from './routes/admin-tenders'; // <-- DEFAULT IMPORT (perbaikan)

// Role guards (optional)
import { authRequired, employerRequired, adminRequired } from './middleware/role';

const app = express();

const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULT_PORT = Number(process.env.PORT || 4000);

/**
 * FRONTEND_ORIGIN bisa koma separated, contoh:
 * FRONTEND_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
 */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

if (NODE_ENV === 'production') {
  // agar Express membaca IP asli di belakang proxy (Heroku/Render/Nginx)
  app.set('trust proxy', 1);
}

/* --------------------------------- CORS --------------------------------- */
const defaultAllowed = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const envAllowed = FRONTEND_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
const allowedOrigins = Array.from(new Set([...defaultAllowed, ...envAllowed]));

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // server-to-server / tools
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ----------------------------- Basic middlewares ----------------------------- */
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '2mb' })); // JSON only (webhook payments juga JSON)

/* -------------------------------- Static -------------------------------- */
// serve static dari public/uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

/* -------------------------------- Health -------------------------------- */
app.get('/', (_req, res) => res.send('OK'));
app.get('/health', (_req, res) => res.json({ ok: true }));

/* -------------------------------- Routes -------------------------------- */
// Auth kandidat/user
app.use('/auth', authRouter);

// Admin auth / dasar (kalau ada)
app.use('/admin', adminRouter);

// News & Chat API
app.use('/api/news', newsRouter);
app.use('/api/chat', chatRouter);

// Tenders publik (list untuk user)
app.use('/api/tenders', tendersRouter);

// Admin manage tenders (CRUD admin)
app.use('/admin/tenders', adminTendersRouter); // <-- perbaikan di sini

// Employer auth (signup/signin/signout/me)
app.use('/api/employers/auth', employerAuthRouter);

// Employer features (step1–5, profile, dsb.)
app.use('/api/employers', employerRouter);

// Admin plans & payments
app.use('/admin/plans', adminPlansRouter);
app.use('/api/payments', paymentsRouter);

/* ------------------------- Contoh protected endpoints ------------------------ */
app.get('/api/profile', authRequired, (req, res) => {
  res.json({ ok: true, whoami: (req as any).auth });
});

app.get('/api/employer/dashboard', employerRequired, (req, res) => {
  res.json({ ok: true, message: 'Employer-only area', whoami: (req as any).auth });
});

app.post('/api/admin/stats', adminRequired, (req, res) => {
  res.json({ ok: true, message: 'Admin-only area', whoami: (req as any).auth });
});

/* --------------------------------- 404 last -------------------------------- */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

/* ------------------------------ Error handler ------------------------------ */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  if (err instanceof Error && err.message.startsWith('Not allowed by CORS')) {
    return res.status(403).json({ error: 'CORS: Origin not allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

/* ------------------------------ Listen server ------------------------------ */
function startServer(startPort: number, maxTries = 10) {
  let port = startPort;
  let tries = 0;
  const server = http.createServer(app);

  function tryListen() {
    server.listen(port);
  }

  server.on('listening', () => {
    console.log('========================================');
    console.log(`🚀 Backend listening on http://localhost:${port}`);
    console.log(`NODE_ENV           : ${NODE_ENV}`);
    console.log(`FRONTEND_ORIGIN(s) : ${allowedOrigins.join(', ')}`);
    console.log('========================================');
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE' && tries < maxTries) {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tries += 1;
      port += 1;
      setTimeout(tryListen, 200);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  });

  tryListen();
}

startServer(DEFAULT_PORT);
