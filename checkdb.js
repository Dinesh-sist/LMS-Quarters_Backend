require('dotenv').config({ path: 'd:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/.env' });
const { sql, getPool } = require('d:/LMS_QuartersSection/Quarters-Backend/LMS-Quarters_Backend/src/db');
async function run() {
  const pool = await getPool();
  const res = await pool.request().query("SELECT NAME, EMP_OTH, STATUS1 FROM dbo.[Estate_Quarters] WHERE AREA_TYPE = 'JC' AND [QUARTER NUMBER] = '10'");
  console.log('Estate_Quarters:', res.recordset);
  
  if (res.recordset.length > 0 && res.recordset[0].EMP_OTH) {
    const empOth = res.recordset[0].EMP_OTH;
    const res2 = await pool.request().input('emp', sql.NVarChar, empOth).query("SELECT EmployeeId, EmpClass FROM dbo.UserDetails WHERE EmployeeId = @emp");
    console.log('UserDetails:', res2.recordset);
  }
  process.exit(0);
}
run();
