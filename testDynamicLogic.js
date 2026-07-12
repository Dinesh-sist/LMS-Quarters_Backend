const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function run() {
    const pool = await sql.connect(config);
    const applicantsRes = await pool.request().query(`
        SELECT a.Id, a.EmpId, a.EmpName, a.Caste, a.Status, a.QtrType, a.QtrLocation, a.QtrRequested, a.PriorityNo, a.Reason,
               a.Class, a.ReqDate, ud.GradDate, ud.Basic, ud.DateOfJoining, ud.DateOfBirth
        FROM dbo.Quarter_Applications a
        LEFT JOIN dbo.UserDetails ud ON a.UserId = ud.UserId
    `);
    console.log('Total Apps in DB:', applicantsRes.recordset.length);
    console.log('App Statuses:', [...new Set(applicantsRes.recordset.map(r => r.Status))]);
    
    const pendingApps = applicantsRes.recordset.filter(r => String(r.Status).trim().toLowerCase() === 'pending');
    console.log('Pending Apps (lowercase check):', pendingApps.length);
    
    const sqlPendingRes = await pool.request().query(`
        SELECT COUNT(*) as count FROM dbo.Quarter_Applications WHERE Status = 'Pending'
    `);
    console.log('SQL Pending count:', sqlPendingRes.recordset[0].count);
    
    process.exit(0);
}
run();
