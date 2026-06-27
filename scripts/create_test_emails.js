require("dotenv").config();
const { getPool, sql } = require("../src/db");

async function run() {
  try {
    const pool = await getPool();
    await pool.request().query(`
      IF OBJECT_ID('dbo.TestEmails', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.TestEmails (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          EmailAddress NVARCHAR(200) NOT NULL
        );
      END
    `);
    
    // Clear and insert
    await pool.request().query(`DELETE FROM dbo.TestEmails`);
    
    await pool.request()
      .input("EmailAddress", sql.NVarChar(200), "thirudhinesh1@gmail.com")
      .query(`
        INSERT INTO dbo.TestEmails (EmailAddress)
        VALUES (@EmailAddress)
      `);
      
    console.log("Successfully created TestEmails table and inserted thirudhinesh1@gmail.com");
    process.exit(0);
  } catch (err) {
    console.error("Error setting up TestEmails:", err);
    process.exit(1);
  }
}

run();
