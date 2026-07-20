require('dotenv').config();
const { getPool } = require('./src/db');

async function test() {
  const pool = await getPool();
  console.log("Connected to DB");
  
  const columns = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UserDetails'
  `);
  console.log("UserDetails Columns:");
  console.table(columns.recordset);
}

test().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
