"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.employerRouter = void 0;
// src/routes/employer.ts
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cookie_1 = require("cookie");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const multer_1 = __importDefault(require("multer"));
const employer_1 = require("../validators/employer");
const employer_2 = require("../services/employer");
const prisma_1 = require("../lib/prisma");
exports.employerRouter = (0, express_1.Router)();
/* ================== AUTH HELPERS (pakai emp_token) ================== */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
function getEmployerAuth(req) {
    const raw = req.headers.cookie || '';
    const cookies = (0, cookie_1.parse)(raw);
    const token = cookies['emp_token'];
    if (!token)
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (payload.role !== 'employer' || !payload.eid)
            return null;
        return { adminUserId: payload.uid, employerId: payload.eid };
    }
    catch {
        return null;
    }
}
/* ================== MULTER (upload logo) ================== */
// ⬇⬇⬇ simpan ke /uploads, sama seperti static server di index.ts
const uploadDir = node_path_1.default.join(process.cwd(), 'public', 'uploads', 'employers');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = node_path_1.default.extname(file.originalname).toLowerCase();
        const name = `logo_${Date.now()}${ext || '.png'}`;
        cb(null, name);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (_req, file, cb) => {
        if (!/^image\//.test(file.mimetype))
            return cb(new Error('Invalid file type'));
        cb(null, true);
    },
});
/* ================== ALUR 5 STEP SIGNUP EMPLOYER ================== */
exports.employerRouter.get('/availability', async (req, res, next) => {
    try {
        const data = await (0, employer_2.checkAvailability)({
            slug: req.query.slug || '',
            email: req.query.email || '',
        });
        res.json(data);
    }
    catch (e) {
        next(e);
    }
});
exports.employerRouter.post('/step1', async (req, res, next) => {
    try {
        const parsed = employer_1.Step1Schema.parse(req.body);
        const result = await (0, employer_2.createAccount)(parsed);
        res.json({ ok: true, ...result, next: '/api/employers/step2' });
    }
    catch (e) {
        if (e?.code === 'P2002')
            return res.status(409).json({ error: 'Email already used' });
        if (e?.issues)
            return res.status(400).json({ error: 'Validation error', details: e.issues });
        next(e);
    }
});
exports.employerRouter.post('/step2', async (req, res, next) => {
    try {
        const parsed = employer_1.Step2Schema.parse(req.body);
        const { employerId, ...profile } = parsed;
        const data = await (0, employer_2.upsertProfile)(employerId, profile);
        res.json({ ok: true, data, next: '/api/employers/step3' });
    }
    catch (e) {
        if (e?.issues)
            return res.status(400).json({ error: 'Validation error', details: e.issues });
        next(e);
    }
});
exports.employerRouter.post('/step3', async (req, res, next) => {
    try {
        const parsed = employer_1.Step3Schema.parse(req.body);
        const data = await (0, employer_2.choosePlan)(parsed.employerId, parsed.planSlug);
        res.json({ ok: true, data, next: '/api/employers/step4' });
    }
    catch (e) {
        if (e?.issues)
            return res.status(400).json({ error: 'Validation error', details: e.issues });
        next(e);
    }
});
exports.employerRouter.post('/step4', async (req, res, next) => {
    try {
        const parsed = employer_1.Step4Schema.parse(req.body);
        const { employerId, ...rest } = parsed;
        const data = await (0, employer_2.createDraftJob)(employerId, rest);
        res.json({ ok: true, data, next: '/api/employers/step5' });
    }
    catch (e) {
        if (e?.issues)
            return res.status(400).json({ error: 'Validation error', details: e.issues });
        next(e);
    }
});
exports.employerRouter.post('/step5', async (req, res, next) => {
    try {
        const parsed = employer_1.Step5Schema.parse(req.body);
        const data = await (0, employer_2.submitVerification)(parsed.employerId, parsed.note, parsed.files);
        let slug = null;
        try {
            const emp = await prisma_1.prisma.employer.findUnique({
                where: { id: parsed.employerId },
                select: { slug: true },
            });
            slug = emp?.slug ?? null;
        }
        catch {
            slug = null;
        }
        res.json({
            ok: true,
            data,
            onboarding: 'completed',
            message: 'Verifikasi terkirim. Silakan sign in untuk melanjutkan.',
            signinRedirect: slug ? `/auth/signin?employerSlug=${encodeURIComponent(slug)}` : `/auth/signin`,
        });
    }
    catch (e) {
        if (e?.issues)
            return res.status(400).json({ error: 'Validation error', details: e.issues });
        next(e);
    }
});
/* ================== ENDPOINT SESI/UTILITY UNTUK FE ================== */
exports.employerRouter.get('/me', async (req, res) => {
    const auth = getEmployerAuth(req);
    if (!auth)
        return res.status(401).json({ message: 'Unauthorized' });
    const employer = await prisma_1.prisma.employer.findUnique({
        where: { id: auth.employerId },
        select: { id: true, slug: true, displayName: true, legalName: true, website: true },
    });
    if (!employer)
        return res.status(404).json({ message: 'Employer not found' });
    return res.json({ employer });
});
exports.employerRouter.get('/profile', async (req, res) => {
    const employerId = req.query.employerId || '';
    if (!employerId)
        return res.status(400).json({ message: 'employerId required' });
    const p = await prisma_1.prisma.employerProfile.findUnique({
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
exports.employerRouter.post('/update-basic', async (req, res) => {
    const { employerId, displayName, legalName, website } = req.body || {};
    if (!employerId)
        return res.status(400).json({ message: 'employerId required' });
    const data = {};
    if (typeof displayName === 'string')
        data.displayName = displayName.trim();
    if (typeof legalName === 'string')
        data.legalName = legalName.trim();
    if (typeof website === 'string' || website === null)
        data.website = website || null;
    if (!Object.keys(data).length)
        return res.json({ ok: true });
    const updated = await prisma_1.prisma.employer.update({
        where: { id: employerId },
        data,
        select: { id: true, displayName: true, legalName: true, website: true },
    });
    return res.json({ ok: true, employer: updated });
});
exports.employerRouter.post('/profile/logo', upload.single('file'), async (req, res) => {
    const mreq = req;
    const employerId = (mreq.body?.employerId || '').trim();
    if (!employerId)
        return res.status(400).json({ message: 'employerId required' });
    if (!mreq.file)
        return res.status(400).json({ message: 'file required' });
    const publicUrl = `/uploads/employers/${mreq.file.filename}`;
    await prisma_1.prisma.employerProfile.upsert({
        where: { employerId },
        create: { employerId, logoUrl: publicUrl },
        update: { logoUrl: publicUrl },
    });
    return res.json({ ok: true, url: publicUrl });
});
/* ========= contoh dummy ========= */
exports.employerRouter.get('/stats', async (req, res) => {
    const auth = getEmployerAuth(req);
    if (!auth)
        return res.status(401).json({ message: 'Unauthorized' });
    res.json({
        activeJobs: 0, totalApplicants: 0, interviews: 0, views: 0,
        lastUpdated: new Date().toISOString(),
    });
});
exports.employerRouter.get('/jobs', async (req, res) => {
    const auth = getEmployerAuth(req);
    if (!auth)
        return res.status(401).json({ message: 'Unauthorized' });
    res.json([]);
});
exports.employerRouter.get('/applications', async (req, res) => {
    const auth = getEmployerAuth(req);
    if (!auth)
        return res.status(401).json({ message: 'Unauthorized' });
    res.json([]);
});
exports.default = exports.employerRouter;
