// Creates (or resets the password of) a Super Admin — the Waynur team login
// for /admin. Run on the server after migrate:
//   SUPER_ADMIN_PASSWORD='a long password' npm run create-admin -- admin@waynur.com "Pankaj Thakur"
// The password is read from the environment so it never lands in shell history
// as an argument or in the repo.
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const name = String(process.argv[3] || 'Waynur Admin').trim();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: SUPER_ADMIN_PASSWORD=... npm run create-admin -- <email> "<name>"');
  if (password.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO super_admins (name, email, password_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name RETURNING id, (xmax = 0) AS created`,
    [name, email, hash]);
  console.log(rows[0].created ? `Super Admin ${email} created.` : `Password reset for Super Admin ${email}.`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => pool.end());
