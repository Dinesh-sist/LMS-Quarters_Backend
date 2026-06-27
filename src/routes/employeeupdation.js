const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const LABEL_TO_DB = {
  "Sr.Class 1": "SR-CLASS-I",
  "Jr.Class 1": "JR-CLASS-I",
  "Class 2": "CLASS-II",
  "Class 3": "CLASS-III",
  "Class 4": "CLASS-IV",
};

// Auto-derived reverse map: "SR-CLASS-I" -> "Sr.Class 1", etc.
const DB_TO_LABEL = Object.fromEntries(
  Object.entries(LABEL_TO_DB).map(([label, dbValue]) => [dbValue, label])
);

const VALID_LABELS = Object.keys(LABEL_TO_DB);

router.get("/employee/classes", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        [EmployeeId]               AS empId,
        [EmployeeName]             AS empName,
        [DPT_NM]                   AS department,
        LTRIM(RTRIM([ClassName]))  AS currentClass
      FROM [LMSQuartersNew].[dbo].[UserDetails]
    `);

    const rows = result.recordset.map((row) => ({
      ...row,
      currentClass: DB_TO_LABEL[row.currentClass] || row.currentClass,
    }));

    res.json(rows);
  } catch (err) {
    console.error("GET /employeeupdation/employee/classes failed:", err);
    res.status(500).json({ message: err.message, code: err.code }); // TEMP — revert after debugging
  }
});

// ---------------------------------------------------------------------------
// POST /employee-classes/update
// ---------------------------------------------------------------------------
router.post("/employee-classes/update", requireAuth, async (req, res) => {
  const { empId, newClass } = req.body || {};

  if (!empId || !newClass) {
    return res.status(400).json({ message: "empId and newClass are required." });
  }

  if (!VALID_LABELS.includes(newClass)) {
    return res.status(400).json({
      message: `Invalid class "${newClass}". Must be one of: ${VALID_LABELS.join(", ")}`,
    });
  }

  const dbClassValue = LABEL_TO_DB[newClass];

  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("empId", empId)
      .input("dbClassValue", dbClassValue)
      .query(`
        UPDATE [LMSQuartersNew].[dbo].[UserDetails]
        SET [ClassName] = @dbClassValue
        WHERE [EmployeeId] = @empId;

        SELECT
          [EmployeeId]               AS empId,
          [EmployeeName]             AS empName,
          [DPT_NM]                   AS department,
          LTRIM(RTRIM([ClassName]))  AS currentClass
        FROM [LMSQuartersNew].[dbo].[UserDetails]
        WHERE [EmployeeId] = @empId;
      `);

    const updatedRow = result.recordset?.[0];

    if (!updatedRow) {
      return res.status(404).json({ message: `No employee found with id ${empId}.` });
    }

    res.json({
      ...updatedRow,
      currentClass: DB_TO_LABEL[updatedRow.currentClass] || updatedRow.currentClass,
    });
  } catch (err) {
    console.error("POST /employeeupdation/employee-classes/update failed:", err);
    res.status(500).json({ message: err.message, code: err.code });
  }
});

module.exports = router;