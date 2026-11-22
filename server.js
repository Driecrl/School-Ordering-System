import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import mariadb from 'mariadb';

const root = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const databaseName = process.env.DB_NAME || 'qcu_canteen';
const required = ['DB_HOST', 'DB_USER', 'SESSION_SECRET', 'PIN_PEPPER'];
for (const key of required) {
  if (!process.env[key] || process.env[key].startsWith('replace-with-')) {
    throw new Error(`${key} must be set in the environment before starting the server.`);
  }
}
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
if (Buffer.byteLength(process.env.SESSION_SECRET) < 32 || Buffer.byteLength(process.env.PIN_PEPPER) < 32) {
  throw new Error('SESSION_SECRET and PIN_PEPPER must each be at least 32 characters.');
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: databaseName,
  connectionLimit: 10,
  connectTimeout: 10_000,
});
const app = express();
const cookieName = isProduction ? '__Host-qcu.sid' : 'qcu.sid';
const csrfHeader = 'x-csrf-token';
const genericLoginError = 'ID or PIN was not recognized.';
const pinOptions = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const pinAttemptsBeforeLock = 5;
const lockMinutes = 15;
const dummyPinHash = await hash(`000000:${process.env.PIN_PEPPER}`, pinOptions);

function getSessionExpiry(sess) {
  const expires = sess?.cookie?.expires;
  if (expires) {
    const time = new Date(expires).getTime();
    if (Number.isFinite(time)) return time;
  }
  return Date.now() + Number(sess?.cookie?.maxAge || 8 * 60 * 60 * 1000);
}

class MariaDbSessionStore extends session.Store {
  constructor(dbPool) {
    super();
    this.pool = dbPool;
    this.cleanup = setInterval(() => {
      this.pool.query('DELETE FROM web_sessions WHERE expires_at <= ?', [Date.now()]).catch((error) => {
        console.error('Session cleanup failed:', error.message);
      });
    }, 15 * 60 * 1000);
    this.cleanup.unref();
  }

  get(sessionId, callback) {
    this.pool.query(
      'SELECT session_data FROM web_sessions WHERE session_id = ? AND expires_at > ? LIMIT 1',
      [sessionId, Date.now()],
    ).then((rows) => {
      if (!rows.length) return callback(null, null);
      try {
        callback(null, JSON.parse(rows[0].session_data));
      } catch (error) {
        callback(error);
      }
    }).catch(callback);
  }

  set(sessionId, sess, callback) {
    this.pool.query(
      `INSERT INTO web_sessions (session_id, expires_at, session_data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), session_data = VALUES(session_data)`,
      [sessionId, getSessionExpiry(sess), JSON.stringify(sess)],
    ).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  touch(sessionId, sess, callback) {
    this.pool.query(
      'UPDATE web_sessions SET expires_at = ? WHERE session_id = ?',
      [getSessionExpiry(sess), sessionId],
    ).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  destroy(sessionId, callback) {
    this.pool.query('DELETE FROM web_sessions WHERE session_id = ?', [sessionId])
      .then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  close() {
    clearInterval(this.cleanup);
  }
}

const sessionStore = new MariaDbSessionStore(pool);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.json({ limit: '16kb', strict: true }));
app.use(session({
  name: cookieName,
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait and try again.' },
});
const pinChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PIN changes. Please wait and try again.' },
});

function newCsrfToken() {
  return randomBytes(32).toString('hex');
}

function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isWeakPin(pin) {
  return /^(.)\1{5}$/.test(pin) || ['012345', '123456', '654321'].includes(pin);
}

function requireCsrf(req, res, next) {
  if (!safeTokenEqual(req.session?.csrfToken, req.get(csrfHeader))) {
    return res.status(403).json({ error: 'Refresh the page and try again.' });
  }
  next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

async function loadSessionAccount(req) {
  if (!req.session?.accountId) return null;
  const rows = await pool.query(
    'SELECT id, account_number, display_name, role, must_change_pin, active FROM accounts WHERE id = ? LIMIT 1',
    [req.session.accountId],
  );
  const account = rows[0];
  if (!account?.active) return null;
  return account;
}

function requireAccount({ allowPinChange = false, role = null } = {}) {
  return async (req, res, next) => {
    try {
      const account = await loadSessionAccount(req);
      if (!account) return res.status(401).json({ error: 'Please sign in to continue.' });
      req.account = account;
      if (account.must_change_pin && !allowPinChange) {
        return res.status(403).json({ code: 'PIN_CHANGE_REQUIRED', error: 'Change your temporary PIN to continue.' });
      }
      if (role && account.role !== role) return res.status(403).json({ error: 'You do not have access to that action.' });
      next();
    } catch (error) {
      next(error);
    }
  };
}

function formatOrderId(id) {
  return `QC-${String(id).padStart(3, '0')}`;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/auth/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = newCsrfToken();
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const account = await loadSessionAccount(req);
    if (!account) return res.status(401).json({ error: 'Please sign in to continue.' });
    res.set('Cache-Control', 'no-store');
    res.json({
      id: String(account.id),
      accountNumber: account.account_number,
      name: account.display_name,
      role: account.role,
      mustChangePin: Boolean(account.must_change_pin),
      csrfToken: req.session.csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', loginLimiter, requireCsrf, async (req, res, next) => {
  try {
    const accountNumber = typeof req.body?.accountNumber === 'string'
      ? req.body.accountNumber.trim().toUpperCase().slice(0, 80)
      : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    const validPinFormat = /^\d{6}$/.test(pin);
    const rows = accountNumber
      ? await pool.query(
        `SELECT *, (locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP(3)) AS is_locked
           FROM accounts WHERE account_number = ? LIMIT 1`,
        [accountNumber],
      )
      : [];
    const account = rows[0];
    const pinHash = account?.active ? account.pin_hash : dummyPinHash;
    const verified = await verify(pinHash, validPinFormat ? `${pin}:${process.env.PIN_PEPPER}` : `000000:${process.env.PIN_PEPPER}`);
    if (!account || !account.active || !validPinFormat || !verified || Boolean(account.is_locked)) {
      if (account?.active && !account.is_locked) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const currentRows = await connection.query('SELECT failed_attempts FROM accounts WHERE id = ? FOR UPDATE', [account.id]);
          const nextAttempts = Number(currentRows[0]?.failed_attempts || 0) + 1;
          const lockedUntil = nextAttempts >= pinAttemptsBeforeLock
            ? `DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${lockMinutes} MINUTE)`
            : 'NULL';
          await connection.query(
            `UPDATE accounts SET failed_attempts = ?, locked_until = ${lockedUntil} WHERE id = ?`,
            [nextAttempts, account.id],
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }
      return res.status(401).json({ error: genericLoginError });
    }

    if (account.must_change_pin && account.pin_expires_at && Number(account.pin_expires_at) < Date.now()) {
      return res.status(403).json({ code: 'TEMP_PIN_EXPIRED', error: 'Temporary PIN expired. Please contact canteen staff for a reset.' });
    }

    await pool.query('UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [account.id]);
    await regenerateSession(req);
    req.session.accountId = String(account.id);
    req.session.csrfToken = newCsrfToken();
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({
      id: String(account.id),
      accountNumber: account.account_number,
      name: account.display_name,
      role: account.role,
      mustChangePin: Boolean(account.must_change_pin),
      csrfToken: req.session.csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/change-pin', pinChangeLimiter, requireCsrf, requireAccount({ allowPinChange: true }), async (req, res, next) => {
  try {
    const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin : '';
    if (!req.account.must_change_pin) return res.status(409).json({ error: 'There is no temporary PIN to change.' });
    if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ error: 'PIN must contain exactly six digits.' });
    if (isWeakPin(newPin)) return res.status(400).json({ error: 'Choose a less predictable six-digit PIN.' });
    const rows = await pool.query('SELECT pin_hash FROM accounts WHERE id = ? LIMIT 1', [req.account.id]);
    if (await verify(rows[0].pin_hash, `${newPin}:${process.env.PIN_PEPPER}`)) {
      return res.status(400).json({ error: 'Choose a PIN different from the temporary PIN.' });
    }
    const pinHash = await hash(`${newPin}:${process.env.PIN_PEPPER}`, pinOptions);
    await pool.query(
      `UPDATE accounts SET pin_hash = ?, must_change_pin = FALSE, pin_expires_at = NULL,
                           failed_attempts = 0, locked_until = NULL
        WHERE id = ?`,
      [pinHash, req.account.id],
    );
    await regenerateSession(req);
    req.session.accountId = String(req.account.id);
    req.session.csrfToken = newCsrfToken();
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({
      id: String(req.account.id),
      accountNumber: req.account.account_number,
      name: req.account.display_name,
      role: req.account.role,
      mustChangePin: false,
      csrfToken: req.session.csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie(cookieName, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });
});

app.get('/api/menu', requireAccount({ role: 'student' }), async (_req, res, next) => {
  try {
    const rows = await pool.query(
      'SELECT id, name, category, description, price_cents, available FROM menu_items WHERE available = TRUE ORDER BY display_order, name',
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      description: item.description,
      priceCents: item.price_cents,
      available: Boolean(item.available),
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', requireAccount(), async (req, res, next) => {
  try {
    const orders = await pool.query(
      `SELECT o.id, o.status, o.total_cents, o.created_at, a.display_name AS student_name
         FROM orders o JOIN accounts a ON a.id = o.account_id
        WHERE (? = 'staff' OR o.account_id = ?)
        ORDER BY o.created_at DESC LIMIT 300`,
      [req.account.role, req.account.id],
    );
    const itemsByOrder = new Map(orders.map((order) => [String(order.id), []]));
    if (orders.length) {
      const ids = orders.map((order) => order.id);
      const items = await pool.query(
        `SELECT order_id, item_name, quantity, unit_price_cents
           FROM order_items WHERE order_id IN (${placeholders(ids.length)}) ORDER BY id`,
        ids,
      );
      for (const item of items) {
        itemsByOrder.get(String(item.order_id))?.push({
          name: item.item_name,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
        });
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json(orders.map((order) => ({
      id: formatOrderId(order.id),
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      student: order.student_name,
      items: itemsByOrder.get(String(order.id)) || [],
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', requireCsrf, requireAccount({ role: 'student' }), async (req, res, next) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 15) {
    return res.status(400).json({ error: 'Choose at least one available menu item.' });
  }
  const unique = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10 || unique.has(item.id)) {
      return res.status(400).json({ error: 'Review item quantities and try again.' });
    }
    unique.add(item.id);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const menuItems = await connection.query(
      `SELECT id, name, price_cents FROM menu_items WHERE available = TRUE AND id IN (${placeholders(items.length)}) FOR UPDATE`,
      items.map((item) => item.id),
    );
    const menu = new Map(menuItems.map((item) => [item.id, item]));
    if (menu.size !== items.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'A menu item is no longer available. Refresh the menu and try again.' });
    }
    const totalCents = items.reduce((sum, item) => sum + Number(menu.get(item.id).price_cents) * item.quantity, 0);
    const inserted = await connection.query(
      'INSERT INTO orders (account_id, total_cents) VALUES (?, ?)',
      [req.account.id, totalCents],
    );
    const orderId = String(inserted.insertId);
    for (const item of items) {
      const menuItem = menu.get(item.id);
      await connection.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price_cents)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, menuItem.id, menuItem.name, item.quantity, menuItem.price_cents],
      );
    }
    await connection.commit();
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      id: formatOrderId(orderId),
      status: 'Received',
      totalCents,
      createdAt: new Date(),
      student: req.account.display_name,
      items: items.map((item) => ({
        name: menu.get(item.id).name,
        quantity: item.quantity,
        unitPriceCents: Number(menu.get(item.id).price_cents),
      })),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    next(error);
  } finally {
    connection.release();
  }
});

app.patch('/api/orders/:id/status', requireCsrf, requireAccount({ role: 'staff' }), async (req, res, next) => {
  try {
    const id = req.params.id.replace(/^QC-/i, '');
    if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'Order not found.' });
    const nextStatus = req.body?.status;
    const expectedStatus = nextStatus === 'Preparing' ? 'Received' : nextStatus === 'Ready for pickup' ? 'Preparing' : null;
    if (!expectedStatus) return res.status(400).json({ error: 'Choose a valid next status.' });
    const updated = await pool.query(
      'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
      [nextStatus, id, expectedStatus],
    );
    if (!updated.affectedRows) return res.status(409).json({ error: 'Order status has changed. Refresh the order list.' });
    res.set('Cache-Control', 'no-store');
    res.json({ id: formatOrderId(id), status: nextStatus });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(root, 'public'), { index: 'index.html', maxAge: isProduction ? '1h' : 0 }));

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');
await pool.query('SELECT 1');
app.listen(port, host, () => console.log(`QCU Canteen server listening on ${host}:${port}`));

async function shutdown() {
  sessionStore.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
