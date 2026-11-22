import { readFile } from 'node:fs/promises';
import mariadb from 'mariadb';

const databaseName = process.env.DB_NAME || 'qcu_canteen';
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
if (!process.env.DB_HOST || !process.env.DB_USER) throw new Error('DB_HOST and DB_USER are required. Configure them in .env first.');

const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  connectionLimit: 3,
  connectTimeout: 10_000,
};

let connection;
try {
  connection = await mariadb.createConnection(config);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally {
  await connection?.end();
}

const pool = mariadb.createPool({ ...config, database: databaseName });
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  console.log(`MariaDB database '${databaseName}' is ready.`);
} finally {
  await pool.end();
}
