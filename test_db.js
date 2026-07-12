require('dotenv').config();
const { sql, getPool } = require('./src/db');
(async () => {
  const pool = await getPool();
  const res1 = await pool.request().query("SELECT Id, Status, QtrType, QtrLocation, QtrRequested, RosterNo FROM dbo.Quarter_Applications WHERE Status='approved' OR Status='Allotted'");
  console.log('Approved Apps:', res1.recordset);
  const res2 = await pool.request().query('SELECT QuarterType, CurrentNumber FROM dbo.Roster_Counters');
  console.log('Counters:', res2.recordset);
  process.exit(0);
})();
