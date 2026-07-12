require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  }
};

async function syncDates() {
  try {
    await sql.connect(config);
    console.log("Connected to DB");

    // 1. Get current active publication
    const pubResult = await sql.query(`
      SELECT TOP 1 
        CONVERT(varchar(10), From_Date, 23) AS From_Date,
        CONVERT(varchar(10), To_Date, 23) AS To_Date
      FROM dbo.Publish
      WHERE Current_State = 'Published'
      ORDER BY PublishID DESC
    `);

    if (pubResult.recordset.length === 0) {
      console.log("No active publication found.");
      process.exit(1);
    }

    const pub = pubResult.recordset[0];
    console.log("Active Publication:", pub);

    // 2. Update all applications to match this publication period and set to pending
    const updateResult = await sql.query(`
      UPDATE dbo.Quarter_Applications
      SET PublishedDateFrom = '${pub.From_Date}',
          PublishedDateTo = '${pub.To_Date}',
          Status = 'pending'
    `);

    console.log(`Updated ${updateResult.rowsAffected[0]} applications to use the current publication dates and reset them to 'pending'.`);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

syncDates();
