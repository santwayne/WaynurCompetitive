// Demo data for showing Waynur Competitive to a centre.
//   node scripts/seed.js            (needs DATABASE_URL; run migrate first)
// Creates "Demo Coaching Centre" with an owner, a teacher, a CGL batch of 8
// students and an approved question bank in 3 topics. Safe to run again:
// it does nothing if the demo owner already exists.
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const OWNER = { email: 'demo.owner@waynur.com', password: process.env.DEMO_PASSWORD || 'demo-owner-2026' };

function percentages() {
  const out = [];
  for (const [p, n] of [[10, 250], [15, 400], [20, 350], [25, 480], [12, 500], [30, 260], [40, 175], [5, 920]]) {
    const a = (p * n) / 100;
    out.push({ stem: `What is ${p}% of ${n}?`, options: [a, a + 5, a * 2, a - 3].map(String), correct: 0,
      explanation: `${p}% of ${n} = ${p}/100 × ${n} = ${a}.` });
  }
  return out;
}
// Rounded, with repeats dropped (keeps the first = correct answer first).
function distinct(values) {
  return [...new Set(values.map((x) => Math.round(x * 100) / 100))];
}
function timeWork() {
  const out = [];
  for (const [a, b] of [[10, 15], [12, 24], [20, 30], [6, 12], [8, 24], [15, 30], [18, 36], [9, 18]]) {
    const t = (a * b) / (a + b);
    out.push({ stem: `A can finish a job in ${a} days and B in ${b} days. Working together, in how many days will they finish it?`,
      options: distinct([t, (a + b) / 2, t + 2, Math.min(a, b) - 1, t + 3, t + 4]).slice(0, 4).map(String), correct: 0,
      explanation: `Add the work per day: 1/${a} + 1/${b} = ${a + b}/${a * b}. Days together = ${a * b}/${a + b} = ${Math.round(t * 100) / 100}.` });
  }
  return out;
}
const syllogism = [
  ['All pens are books. All books are bags. Conclusion: All pens are bags.', ['Follows', 'Does not follow', 'Cannot say', 'Only if some bags are pens'], 0, 'All A are B and all B are C, so all A are C.'],
  ['Some cats are dogs. All dogs are rats. Conclusion: Some cats are rats.', ['Follows', 'Does not follow', 'Cannot say', 'Only if all cats are dogs'], 0, 'The cats that are dogs are also rats, so some cats are rats.'],
  ['All roses are flowers. Some flowers are red. Conclusion: Some roses are red.', ['Does not follow', 'Follows', 'Definitely true', 'Definitely false'], 0, 'The red flowers may not be roses, so it does not follow.'],
  ['No pen is a pencil. All pencils are erasers. Conclusion: No pen is an eraser.', ['Does not follow', 'Follows', 'Definitely true', 'Only if all erasers are pencils'], 0, 'Erasers that are not pencils may be pens, so it does not follow.'],
  ['All trains are buses. No bus is a car. Conclusion: No train is a car.', ['Follows', 'Does not follow', 'Cannot say', 'Only if some cars are buses'], 0, 'Every train is a bus and no bus is a car, so no train is a car.'],
  ['Some books are pens. Some pens are tables. Conclusion: Some books are tables.', ['Does not follow', 'Follows', 'Definitely true', 'Only if all pens are tables'], 0, 'Two "some" statements give no definite link between books and tables.'],
].map(([stem, options, correct, explanation]) => ({ stem, options, correct, explanation }));

async function main() {
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [OWNER.email]);
  if (exists.rowCount) { console.log('Demo centre already exists.'); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = (await client.query(`INSERT INTO centres (name, city) VALUES ('Demo Coaching Centre', 'Ludhiana') RETURNING id`)).rows[0].id;
    const owner = (await client.query(`INSERT INTO users (centre_id, name, email, password_hash, role) VALUES ($1,'Demo Owner',$2,$3,'owner') RETURNING id`,
      [c, OWNER.email, await bcrypt.hash(OWNER.password, 10)])).rows[0].id;
    await client.query(`INSERT INTO users (centre_id, name, email, password_hash, role) VALUES ($1,'Ravi (Quant)','demo.teacher@waynur.com',$2,'teacher')`,
      [c, await bcrypt.hash(OWNER.password, 10)]);
    const cgl = (await client.query(`SELECT id FROM exam_patterns WHERE code = 'SSC-CGL-T1' AND centre_id IS NULL ORDER BY version DESC LIMIT 1`)).rows[0]?.id ?? null;
    const batch = (await client.query(`INSERT INTO batches (centre_id, name, exam_pattern_id) VALUES ($1,'CGL Morning 2026',$2) RETURNING id`, [c, cgl])).rows[0].id;
    const names = ['Aman Gill', 'Baljit Kaur', 'Chetna Sharma', 'Deepak Rana', 'Ekam Singh', 'Farhan Ali', 'Gurleen Kaur', 'Harsh Verma'];
    for (const [i, name] of names.entries()) {
      const phone = `98765000${String(i + 1).padStart(2, '0')}`;
      const s = (await client.query('INSERT INTO students (centre_id, name, phone, roll_no, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [c, name, phone, String(i + 1), await bcrypt.hash(phone, 10)])).rows[0].id;
      await client.query('INSERT INTO batch_students (batch_id, student_id) VALUES ($1,$2)', [batch, s]);
    }
    const topics = [
      ['Quantitative Aptitude', 'Percentages', 'x% of N = x/100 × N. To find what % A is of B: A/B × 100.', percentages()],
      ['Quantitative Aptitude', 'Time & Work', 'Work per day = 1/days. Add the work per day of people working together, then days = 1 ÷ total.', timeWork()],
      ['General Intelligence & Reasoning', 'Syllogism', 'Draw the statements as circles (Venn). A conclusion follows only if it is true in every possible drawing.', syllogism],
    ];
    for (const [subject, name, notes, qs] of topics) {
      const t = (await client.query('INSERT INTO topics (centre_id, subject, name, notes) VALUES ($1,$2,$3,$4) RETURNING id', [c, subject, name, notes])).rows[0].id;
      for (const q of qs) {
        await client.query(`INSERT INTO questions (centre_id, topic_id, stem, options, correct_index, explanation, status, source, created_by, approved_by)
                            VALUES ($1,$2,$3,$4,$5,$6,'approved','manual',$7,$7)`, [c, t, q.stem, JSON.stringify(q.options), q.correct, q.explanation, owner]);
      }
    }
    await client.query('COMMIT');
    console.log(`Demo centre ${c} ready. Owner: ${OWNER.email} / ${OWNER.password}. Students log in at /s/${c} with phone 9876500001… (password = phone).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
