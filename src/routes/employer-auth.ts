// src/routes/employer-auth.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';

const EMP_COOKIE = 'emp_session';
const SESSION_HOURS = 12;

function makeCookie(id: string) {
  const isProd = process.env.NODE_ENV === 'production';
  return serializeCookie(EMP_COOKIE, id, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',          // aman untuk http://localhost:3000
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

const router = Router();

/**
 * POST /api/employers/auth/signin
 * body: { usernameOrEmail, password }
 */
router.post('/signin', async (req, res) => {
  const { usernameOrEmail, password } = req.body || {};
  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
  }

  // cari admin user employer
  const admin = await prisma.employerAdminUser.findFirst({
    where: {
      OR: [
        { email: usernameOrEmail },
        { fullName: usernameOrEmail },
      ],
    },
    select: {
      id: true,
      passwordHash: true,
      employerId: true,
      employer: { select: { id: true, slug: true, displayName: true } },
    },
  });

  if (!admin || !admin.passwordHash) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

  // pastikan employer ada
  const employer = await prisma.employer.findUnique({
    where: { id: admin.employerId },
    select: { id: true, slug: true, displayName: true },
  });
  if (!employer) return res.status(401).json({ error: 'NO_EMPLOYER' });

  // buat session TANPA userId (null) + employerId DIISI
  const now = Date.now();
  const session = await prisma.session.create({
    data: {
      userId: null,                 // <--- penting: null supaya tidak kena FK
      employerId: employer.id,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_HOURS * 60 * 60 * 1000),
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    },
    select: { id: true },
  });

  res.setHeader('Set-Cookie', makeCookie(session.id));
  return res.json({
    ok: true,
    admin: { id: admin.id },
    employer,
  });
});

/**
 * POST /api/employers/auth/signout
 */
router.post('/signout', async (req, res) => {
  try {
    const raw = req.headers.cookie || '';
    const cookies = parseCookie(raw);
    const sid = cookies[EMP_COOKIE];
    if (sid) {
      await prisma.session.updateMany({
        where: { id: sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  } catch {}
  // hapus cookie
  res.setHeader(
    'Set-Cookie',
    serializeCookie(EMP_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
  res.status(204).end();
});

/**
 * GET /api/employers/auth/me
 * Validasi cookie session → kembalikan admin & employer ringkas
 */
router.get('/me', async (req, res) => {
  const raw = req.headers.cookie || '';
  const cookies = parseCookie(raw);
  const sid = cookies[EMP_COOKIE];
  if (!sid) return res.status(401).json({ error: 'NO_SESSION' });

  const s = await prisma.session.findUnique({
    where: { id: sid },
    select: {
      employerId: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt < new Date()) || !s.employerId) {
    return res.status(401).json({ error: 'NO_SESSION' });
  }

  const employer = await prisma.employer.findUnique({
    where: { id: s.employerId },
    select: { id: true, slug: true, displayName: true, legalName: true, website: true },
  });

  if (!employer) return res.status(404).json({ error: 'EMPLOYER_NOT_FOUND' });

  return res.json({
    ok: true,
    admin: { id: s.userId || 'employer-admin' }, // nilai kosmetik
    employer,
  });
});

export default router;
