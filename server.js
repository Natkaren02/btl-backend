import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import searchRouter from './routes/search.js';
import brandsRouter from './routes/brands.js';
import usersRouter from './routes/users.js';
import wardrobeRouter from './routes/wardrobe.js';
import wishlistRouter from './routes/wishlist.js';
import relistRouter from './routes/relist.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── SECURITY ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting — 100 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── MIDDLEWARE ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ── ROUTES ────────────────────────────────────────────────────────
app.use('/api/search',   searchRouter);
app.use('/api/brands',   brandsRouter);
app.use('/api/users',    usersRouter);
app.use('/api/wardrobe', wardrobeRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/relist',   relistRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message
  });
});

app.listen(PORT, () => {
  console.log(`BeyondTheLabel API running on port ${PORT}`);
});

export default app;
