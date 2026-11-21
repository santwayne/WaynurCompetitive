import dotenv from 'dotenv';
import { createApp } from './app.js';

dotenv.config();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set (32+ characters). Refusing to start.');
  process.exit(1);
}
const port = Number(process.env.PORT) || 4100;
createApp().listen(port, () => console.log(`Waynur Competitive API on :${port}`));
