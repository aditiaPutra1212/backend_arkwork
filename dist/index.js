"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const node_path_1 = __importDefault(require("node:path"));
const node_http_1 = __importDefault(require("node:http"));
// Routers (perhatikan mana default dan mana named)
const auth_1 = __importDefault(require("./routes/auth"));
const news_1 = __importDefault(require("./routes/news"));
const chat_1 = __importDefault(require("./routes/chat"));
const admin_1 = __importDefault(require("./routes/admin"));
const employer_1 = require("./routes/employer"); // <-- ini memang named
const employer_auth_1 = __importDefault(require("./routes/employer-auth"));
const admin_plans_1 = __importDefault(require("./routes/admin-plans"));
const payments_1 = __importDefault(require("./routes/payments"));
const tenders_1 = __importDefault(require("./routes/tenders"));
const admin_tenders_1 = __importDefault(require("./routes/admin-tenders")); // <-- DEFAULT IMPORT (perbaikan)
// Role guards (optional)
const role_1 = require("./middleware/role");
const app = (0, express_1.default)();
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
const corsOptions = {
    origin(origin, cb) {
        if (!origin)
            return cb(null, true); // server-to-server / tools
        if (allowedOrigins.includes(origin))
            return cb(null, true);
        return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use((0, cors_1.default)(corsOptions));
app.options('*', (0, cors_1.default)(corsOptions));
/* ----------------------------- Basic middlewares ----------------------------- */
app.use((req, _res, next) => {
    console.log(`${req.method} ${req.originalUrl}`);
    next();
});
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json({ limit: '2mb' })); // JSON only (webhook payments juga JSON)
/* -------------------------------- Static -------------------------------- */
// serve static dari public/uploads
app.use('/uploads', express_1.default.static(node_path_1.default.join(process.cwd(), 'public', 'uploads')));
/* -------------------------------- Health -------------------------------- */
app.get('/', (_req, res) => res.send('OK'));
app.get('/health', (_req, res) => res.json({ ok: true }));
/* -------------------------------- Routes -------------------------------- */
// Auth kandidat/user
app.use('/auth', auth_1.default);
// Admin auth / dasar (kalau ada)
app.use('/admin', admin_1.default);
// News & Chat API
app.use('/api/news', news_1.default);
app.use('/api/chat', chat_1.default);
// Tenders publik (list untuk user)
app.use('/api/tenders', tenders_1.default);
// Admin manage tenders (CRUD admin)
app.use('/admin/tenders', admin_tenders_1.default); // <-- perbaikan di sini
// Employer auth (signup/signin/signout/me)
app.use('/api/employers/auth', employer_auth_1.default);
// Employer features (step1–5, profile, dsb.)
app.use('/api/employers', employer_1.employerRouter);
// Admin plans & payments
app.use('/admin/plans', admin_plans_1.default);
app.use('/api/payments', payments_1.default);
/* ------------------------- Contoh protected endpoints ------------------------ */
app.get('/api/profile', role_1.authRequired, (req, res) => {
    res.json({ ok: true, whoami: req.auth });
});
app.get('/api/employer/dashboard', role_1.employerRequired, (req, res) => {
    res.json({ ok: true, message: 'Employer-only area', whoami: req.auth });
});
app.post('/api/admin/stats', role_1.adminRequired, (req, res) => {
    res.json({ ok: true, message: 'Admin-only area', whoami: req.auth });
});
/* --------------------------------- 404 last -------------------------------- */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
/* ------------------------------ Error handler ------------------------------ */
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    if (err instanceof Error && err.message.startsWith('Not allowed by CORS')) {
        return res.status(403).json({ error: 'CORS: Origin not allowed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});
/* ------------------------------ Listen server ------------------------------ */
function startServer(startPort, maxTries = 10) {
    let port = startPort;
    let tries = 0;
    const server = node_http_1.default.createServer(app);
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
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && tries < maxTries) {
            console.warn(`Port ${port} in use, trying ${port + 1}...`);
            tries += 1;
            port += 1;
            setTimeout(tryListen, 200);
        }
        else {
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
