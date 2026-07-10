const { getPool } = require('./src/db');

async function check() {
  const pool = await getPool();

  console.log('=== Quarter_Emp_Class ===');
  const cls = await pool.request().query(
    'SELECT Class_ID, Class_PRIORITY, class_name, [Class], QTR_ID FROM dbo.Quarter_Emp_Class ORDER BY Class_PRIORITY ASC, Class_ID ASC'
  );
  console.log(JSON.stringify(cls.recordset, null, 2));

  console.log('\n=== Quarter_Allotment_Type ===');
  const qat = await pool.request().query(
    'SELECT QTR_ID, QTR_TYPE FROM dbo.Quarter_Allotment_Type ORDER BY QTR_ID ASC'
  );
  console.log(JSON.stringify(qat.recordset, null, 2));

  console.log('\n=== Class to Quarter Type Mapping ===');
  const mapping = await pool.request().query(
    'SELECT qec.Class_ID, qec.Class_PRIORITY, qec.class_name, qec.[Class], qat.QTR_ID, qat.QTR_TYPE FROM dbo.Quarter_Emp_Class qec JOIN dbo.Quarter_Allotment_Type qat ON qat.QTR_ID = qec.QTR_ID ORDER BY qec.Class_PRIORITY ASC, qat.QTR_ID ASC'
  );
  console.log(JSON.stringify(mapping.recordset, null, 2));

  process.exit(0);
}

check().catch(function(e) {
  console.error(e.message);
  process.exit(1);
});