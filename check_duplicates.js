require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: { encrypt: false, trustServerCertificate: true }
};

async function check() {
  await sql.connect(config);
  const result = await sql.query(`
    SELECT QtrType, QtrLocation, QtrRequested, COUNT(*) as ApprovedCount
    FROM dbo.Quarter_Applications
    WHERE Status = 'approved'
    GROUP BY QtrType, QtrLocation, QtrRequested
    HAVING COUNT(*) > 1
  `);
  console.log("Quarters with multiple approved apps:", result.recordset);
  
  if (result.recordset.length > 0) {
    const q = result.recordset[0];
    const apps = await sql.query(`
      SELECT Id, UserId, EmpName, QtrType, QtrLocation, QtrRequested, Status
      FROM dbo.Quarter_Applications
      WHERE QtrType = '${q.QtrType}' AND QtrLocation = '${q.QtrLocation}' AND QtrRequested = '${q.QtrRequested}'
    `);
    console.log("Apps for first duplicate:", apps.recordset);
  }
  process.exit(0);
}
check();
