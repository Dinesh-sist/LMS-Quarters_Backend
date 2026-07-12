require('dotenv').config({ path: 'd:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/.env' });
const { getPool } = require('d:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/src/db');
async function run() {
  try {
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Roster_Counters' and xtype='U')
      CREATE TABLE dbo.Roster_Counters (
          QuarterType NVARCHAR(64) PRIMARY KEY,
          CurrentNumber INT NOT NULL DEFAULT 1
      );
    `);
    
    const types = ['Atype', 'Btype', 'Btype IIR', 'Ctype', 'Ctype (Modified)', 'Dtype'];
    for (const type of types) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM dbo.Roster_Counters WHERE QuarterType = '${type}')
        INSERT INTO dbo.Roster_Counters (QuarterType, CurrentNumber) VALUES ('${type}', 1);
      `);
    }
    console.log("Roster_Counters table created and seeded.");
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
run();
