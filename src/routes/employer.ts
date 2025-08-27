// src/routes/employer.ts
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import {
  Step1Schema, Step2Schema, Step3Schema, Step4Schema, Step5Schema,
  Step5Input,
} from '../validators/employer';
import {
  checkAvailability,
  createAccount,
  upsertProfile,
  choosePlan,
  createDraftJob,
  submitVerification,
} from '../services/employer';
import { prisma } from '../lib/prisma';

export const employerRouter = Router();

/* ================== AUTH HELPERS (pakai emp_token) ================== */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

type EmployerJWTPayload = {
  uid: string;   // employer admin user id
  role: 'employer';
  eid: string;   // employerId
  iat?: number;
  exp?: number;
};

function getEmployerAuth(req: Request): { adminUserId: string; employerId: string } | null {
  const raw = req.headers.cookie || '';
  const cookies = parseCookie(raw);
  const token = cookies['emp_token'];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as EmployerJWTPayload;
    if (payload.role !== 'employer' || !payload.eid) return null;
    return { adminUserId: payload.uid, employerId: payload.eid };
  } catch {
    return null;
  }
}

/* ================== MULTER (upload logo) ================== */
// ⬇⬇⬇ simpan ke /uploads, sama seperti static server di index.ts
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'employers');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `logo_${Date.now()}${ext || '.png'}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Invalid file type'));
    cb(null, true);
  },
});
type MulterReq = Request & { file?: Express.Multer.File };

/* ================== ALUR 5 STEP SIGNUP EMPLOYER ================== */

employerRouter.get('/availability', async (req, res, next) => {
  try {
    const data = await checkAvailability({
      slug: (req.query.slug as string) || '',
      email: (req.query.email as string) || '',
    });
    res.json(data);
  } catch (e) { next(e); }
});

employerRouter.post('/step1', async (req, res, next) => {
  try {
    const parsed = Step1Schema.parse(req.body);
    const result = await createAccount(parsed);
    res.json({ ok: true, ...result, next: '/api/employers/step2' });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(409).json({ error: 'Email already used' });
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    next(e);
  }
});

employerRouter.post('/step2', async (req, res, next) => {
  try {
    const parsed = Step2Schema.parse(req.body);
    const { employerId, ...profile } = parsed;
    const data = await upsertProfile(employerId, profile);
    res.json({ ok: true, data, next: '/api/employers/step3' });
  } catch (e: any) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    next(e);
  }
});

employerRouter.post('/step3', async (req, res, next) => {
  try {
    const parsed = Step3Schema.parse(req.body);
    const data = await choosePlan(parsed.employerId, parsed.planSlug);
    res.json({ ok: true, data, next: '/api/employers/step4' });
  } catch (e: any) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    next(e);
  }
});

employerRouter.post('/step4', async (req, res, next) => {
  try {
    const parsed = Step4Schema.parse(req.body);
    const { employerId, ...rest } = parsed;
    const data = await createDraftJob(employerId, rest);
    res.json({ ok: true, data, next: '/api/employers/step5' });
  } catch (e: any) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    next(e);
  }
});

employerRouter.post('/step5', async (req, res, next) => {
  try {
    const parsed = Step5Schema.parse(req.body) as Step5Input;
    const data = await submitVerification(
      parsed.employerId,
      parsed.note,
      parsed.files as { url: string; type?: string }[],
    );

    let slug: string | null = null;
    try {
      const emp = await prisma.employer.findUnique({
        where: { id: parsed.employerId },
        select: { slug: true },
      });
      slug = emp?.slug ?? null;
    } catch { slug = null; }

    res.json({
      ok: true,
      data,
      onboarding: 'completed',
      message: 'Verifikasi terkirim. Silakan sign in untuk melanjutkan.',
      signinRedirect: slug ? `/auth/signin?employerSlug=${encodeURIComponent(slug)}` : `/auth/signin`,
    });
  } catch (e: any) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    next(e);
  }
});

/* ================== ENDPOINT SESI/UTILITY UNTUK FE ================== */

employerRouter.get('/me', async (req: Request, res: Response) => {
  const auth = getEmployerAuth(req);
  if (!auth) return res.status(401).json({ message: 'Unauthorized' });

  const employer = await prisma.employer.findUnique({
    where: { id: auth.employerId },
    select: { id: true, slug: true, displayName: true, legalName: true, website: true },
  });
  if (!employer) return res.status(404).json({ message: 'Employer not found' });

  return res.json({ employer });
});

employerRouter.get('/profile', async (req, res) => {
  const employerId = (req.query.employerId as string) || '';
  if (!employerId) return res.status(400).json({ message: 'employerId required' });

  const p = await prisma.employerProfile.findUnique({
    where: { employerId },
    select: {
      about: true,
      hqCity: true,
      hqCountry: true,
      logoUrl: true,
      bannerUrl: true,
      linkedin: true,
      instagram: true,
      twitter: true,
      industry: true,
      size: true,
      foundedYear: true,
      updatedAt: true,
    },
  });
  return res.json(p || {});
});

employerRouter.post('/update-basic', async (req, res) => {
  const { employerId, displayName, legalName, website } = req.body || {};
  if (!employerId) return res.status(400).json({ message: 'employerId required' });

  const data: any = {};
  if (typeof displayName === 'string') data.displayName = displayName.trim();
  if (typeof legalName === 'string') data.legalName = legalName.trim();
  if (typeof website === 'string' || website === null) data.website = website || null;

  if (!Object.keys(data).length) return res.json({ ok: true });

  const updated = await prisma.employer.update({
    where: { id: employerId },
    data,
    select: { id: true, displayName: true, legalName: true, website: true },
  });
  return res.json({ ok: true, employer: updated });
});

employerRouter.post('/profile/logo', upload.single('file'), async (req, res) => {
  const mreq = req as MulterReq;
  const employerId = (mreq.body?.employerId || '').trim();
  if (!employerId) return res.status(400).json({ message: 'employerId required' });
  if (!mreq.file) return res.status(400).json({ message: 'file required' });

  const publicUrl = `/uploads/employers/${mreq.file.filename}`;

  await prisma.employerProfile.upsert({
    where: { employerId },
    create: { employerId, logoUrl: publicUrl },
    update: { logoUrl: publicUrl },
  });

  return res.json({ ok: true, url: publicUrl });
});

/* ========= contoh dummy ========= */
employerRouter.get('/stats', async (req, res) => {
  const auth = getEmployerAuth(req);
  if (!auth) return res.status(401).json({ message: 'Unauthorized' });
  res.json({
    activeJobs: 0, totalApplicants: 0, interviews: 0, views: 0,
    lastUpdated: new Date().toISOString(),
  });
});

employerRouter.get('/jobs', async (req, res) => {
  const auth = getEmployerAuth(req);
  if (!auth) return res.status(401).json({ message: 'Unauthorized' });
  res.json([]);
});

employerRouter.get('/applications', async (req, res) => {
  const auth = getEmployerAuth(req);
  if (!auth) return res.status(401).json({ message: 'Unauthorized' });
  res.json([]);
});

export default employerRouter;
