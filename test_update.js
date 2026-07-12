require('dotenv').config({ path: 'd:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/.env' });
const { sql, getPool } = require('d:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/src/db');

async function testUpdate() {
  const pool = await getPool();
  
  const area = "JC"; 
  const quarterNumber = "10";
  const status = "VACANT";
  
  console.log("Before:");
  const before = await pool.request().query("SELECT TOP 1 NAME, EMP_OTH, STATUS1, [ALLOTMENT ORDER], ALT_DT FROM dbo.[Estate_Quarters] WHERE AREA_TYPE='JC' AND [QUARTER NUMBER]='10'");
  console.log(before.recordset);
  
  const result = await pool
      .request()
      .input("p_Area", sql.NVarChar(64), area)
      .input("p_QuarterNo", sql.NVarChar(64), quarterNumber)
      .input("p_Status", sql.NVarChar(32), status)
      .input("p_EmployeeName", sql.NVarChar(255), "TEST_NAME")
      .input("p_EmployeeId", sql.NVarChar(64), "TEST_ID")
      .input("p_AllotmentId", sql.NVarChar(255), "TEST_ORDER")
      .input("p_AllotmentDate", sql.Date, new Date())
      .query(`
        UPDATE dbo.[Estate_Quarters]
        SET 
          STATUS1 = @p_Status,
          NAME = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_EmployeeName END,
          EMP_OTH = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_EmployeeId END,
          [ALLOTMENT ORDER] = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_AllotmentId END,
          ALT_DT = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_AllotmentDate END
        WHERE CAST(AREA_TYPE AS NVARCHAR(64)) = @p_Area
          AND CAST([QUARTER NUMBER] AS NVARCHAR(64)) = @p_QuarterNo
      `);
      
  console.log("Updated rows:", result.rowsAffected);
  
  console.log("After:");
  const after = await pool.request().query("SELECT TOP 1 NAME, EMP_OTH, STATUS1, [ALLOTMENT ORDER], ALT_DT FROM dbo.[Estate_Quarters] WHERE AREA_TYPE='JC' AND [QUARTER NUMBER]='10'");
  console.log(after.recordset);
  
  // Revert
  await pool.request().query("UPDATE dbo.[Estate_Quarters] SET STATUS1='OCCUPIED', NAME='ASST. COMMISIONER CUSTOM, CUSTOM HOUSE PARADIP', EMP_OTH='C-GOVT' WHERE AREA_TYPE='JC' AND [QUARTER NUMBER]='10'");
  
  process.exit(0);
}

testUpdate();
