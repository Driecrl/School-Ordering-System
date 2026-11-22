import { randomInt } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import mariadb from 'mariadb';

const [action, first, second, ...rest] = process.argv.slice(2);
const usage = 'Usage: pnpm account create <student|staff> <account-number> "<display name>" | pnpm account reset <account-number>';

if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME || !process.env.PIN_PEPPER) {
  throw new Error('DB_HOST, DB_USER, DB_NAME, and PIN_PEPPER are required. Configure them in .env first.');
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  connectionLimit: 3,
});
const ttlHours = Number.parseInt(process.env.TEMP_PIN_TTL_HOURS || '24', 10);
if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
  throw new Error('TEMP_PIN_TTL_HOURS must be a whole number from 1 to 168.');
}

function newTemporaryPin() {
  let pin;
  do {
    pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
  } while (/^(.)\1{5}$/.test(pin) || ['012345', '123456', '654321'].includes(pin));
  return pin;
}

async function hashPin(pin) {
  return hash(`${pin}:${process.env.PIN_PEPPER}`, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

try {
  if (action === 'create') {
    const role = first;
    const accountNumber = second?.trim().toUpperCase();
    const displayName = rest.join(' ').trim();
    if (!['student', 'staff'].includes(role) || !accountNumber || !displayName) throw new Error(usage);
    const pin = newTemporaryPin();
    const pinHash = await hashPin(pin);
    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO accounts (account_number, display_name, role, pin_hash, must_change_pin, pin_expires_at)
       VALUES (?, ?, ?, ?, TRUE, ?)`,
      [accountNumber, displayName, role, pinHash, expires.getTime()],
    );
    console.log(`Account created: ${accountNumber} (${role})`);
    console.log(`Temporary PIN (shown once): ${pin}`);
    console.log(`Expires: ${expires.toISOString()}`);
  } else if (action === 'reset') {
    const accountNumber = first?.trim().toUpperCase();
    if (!accountNumber || second) throw new Error(usage);
    const pin = newTemporaryPin();
    const pinHash = await hashPin(pin);
    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const accounts = await pool.query(
      'SELECT account_number, role FROM accounts WHERE account_number = ? AND active = TRUE LIMIT 1',
      [accountNumber],
    );
    if (!accounts.length) throw new Error('No active account found for that ID.');
    await pool.query(
      `UPDATE accounts
       SET pin_hash = ?, must_change_pin = TRUE, pin_expires_at = ?,
           failed_attempts = 0, locked_until = NULL
       WHERE account_number = ? AND active = TRUE`,
      [pinHash, expires.getTime(), accountNumber],
    );
    console.log(`Temporary PIN reset for ${accounts[0].account_number} (${accounts[0].role}).`);
    console.log(`Temporary PIN (shown once): ${pin}`);
    console.log(`Expires: ${expires.toISOString()}`);
  } else {
    throw new Error(usage);
  }
} finally {
  await pool.end();
}
