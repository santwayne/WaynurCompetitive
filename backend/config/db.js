import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// DATE columns (e.g. a centre's valid_until) come back as 'YYYY-MM-DD'
// strings, not JS Dates that shift with the server's time zone.
pg.types.setTypeParser(1082, (v) => v);

// From Waynur: every "today" must be the Indian calendar day, not the
// server's UTC day. Set as a connection option (not a query on 'connect',
// which races the first real query on a fresh connection).
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  options: '-c timezone=Asia/Kolkata',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

export default pool;
