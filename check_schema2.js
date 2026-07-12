require('dotenv').config({ path: 'd:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/.env' });
const { getPool } = require('d:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/src/db');
async function run() {
  try {
    const pool = await getPool();
    const res = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserDetails'");
    console.log('UserDetails:', res.recordset.map(r => r.COLUMN_NAME).join(', '));
    const res2 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Quarter_Applications'");
    console.log('Quarter_Applications:', res2.recordset.map(r => r.COLUMN_NAME).join(', '));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
run();
