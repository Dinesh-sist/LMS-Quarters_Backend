require('dotenv').config({ path: 'd:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/.env' });
const { sql, getPool } = require('d:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/src/db');
async function run() {
  const pool = await getPool();
  const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserDetails'");
  console.log(res.recordset);
  process.exit(0);
}
run();
