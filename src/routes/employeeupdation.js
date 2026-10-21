const express = require("express");
const { getPool, sql } = require("../db");
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
        [UserId]                   AS userId,
        LTRIM(RTRIM([EmployeeId])) AS empId,
        LTRIM(RTRIM([EmployeeName])) AS empName,
        CONVERT(varchar(10), [DateOfBirth], 23)   AS dob,
        CONVERT(varchar(10), [DateOfJoining], 23) AS doj,
        CONVERT(varchar(10), [DateOfBirth], 23)   AS dateOfBirth,
        CONVERT(varchar(10), [DateOfJoining], 23) AS dateOfJoining,
        CONVERT(varchar(10), [GradDate], 23)      AS gradDate,
        [Basic]                    AS basic,
        LTRIM(RTRIM([DPT_NM]))     AS department,
        LTRIM(RTRIM([EmpClass]))   AS currentClass,
        [Category]                 AS category,
        [Area_type]                AS areaType,
        [Quarter_no]               AS quarterNo,
        CONVERT(varchar(10), [DebarredFromDate], 23) AS debarredFromDate,
        CONVERT(varchar(10), [DebarredToDate], 23)   AS debarredToDate
      FROM [dbo].[UserDetails]
    `);

    const rows = result.recordset.map((row) => ({
      ...row,
      empId: row.empId?.trim() || row.empId,
      empName: row.empName?.trim() || row.empName,
      department: row.department?.trim() || row.department,
      currentClass: DB_TO_LABEL[row.currentClass?.trim()] || row.currentClass?.trim(),
    }));

    res.json(rows);
  } catch (err) {
    console.error("GET /employeeupdation/employee/classes failed:", err);
    res.status(500).json({ message: err.message, code: err.code });
  }
});

// ---------------------------------------------------------------------------
// POST /employee-classes/update
// ---------------------------------------------------------------------------
router.post("/employee-classes/update", requireAuth, async (req, res) => {
  const { empId, newClass, department, basic, gradDate } = req.body || {};

  const cleanEmpId = (empId || "").trim();
  if (!cleanEmpId || !newClass) {
    return res.status(400).json({ message: "empId and newClass are required." });
  }

  if (!VALID_LABELS.includes(newClass)) {
    return res.status(400).json({
      message: `Invalid class "${newClass}". Must be one of: ${VALID_LABELS.join(", ")}`,
    });
  }

  if (!gradDate || !String(gradDate).trim()) {
    return res.status(400).json({ message: "Grade Date is required." });
  }

  const parsedGradDate = new Date(gradDate);
  if (isNaN(parsedGradDate.getTime())) {
    return res.status(400).json({ message: "Invalid Grade Date format." });
  }

  const dbClassValue = LABEL_TO_DB[newClass];

  let parsedBasic = null;
  if (basic !== undefined && basic !== null && basic !== "") {
    parsedBasic = Number(basic);
    if (isNaN(parsedBasic) || parsedBasic < 0) {
      return res.status(400).json({ message: "Basic must be a valid positive number." });
    }
  }

  const cleanDept = department !== undefined && department !== null ? String(department).trim() : null;

  try {
    const pool = await getPool();

    const request = pool.request();
    request.input("empId", sql.NVarChar(50), cleanEmpId);
    request.input("dbClassValue", sql.NVarChar(60), dbClassValue);
    request.input("gradDate", sql.Date, parsedGradDate);
    request.input("department", sql.NVarChar(200), cleanDept);
    request.input("basic", sql.Float, parsedBasic);

    const result = await request.query(`
      UPDATE [dbo].[UserDetails]
      SET [EmpClass] = @dbClassValue,
          [GradDate] = @gradDate,
          [DPT_NM]   = CASE WHEN @department IS NOT NULL THEN @department ELSE [DPT_NM] END,
          [Basic]    = CASE WHEN @basic IS NOT NULL THEN @basic ELSE [Basic] END
      WHERE LTRIM(RTRIM([EmployeeId])) = @empId;

      SELECT
        LTRIM(RTRIM([EmployeeId]))                 AS empId,
        LTRIM(RTRIM([EmployeeName]))               AS empName,
        LTRIM(RTRIM([DPT_NM]))                     AS department,
        [Basic]                                    AS basic,
        CONVERT(varchar(10), [GradDate], 23)       AS gradDate,
        LTRIM(RTRIM([EmpClass]))                   AS currentClass
      FROM [dbo].[UserDetails]
      WHERE LTRIM(RTRIM([EmployeeId])) = @empId;
    `);

    const updatedRow = result.recordset?.[0];

    if (!updatedRow) {
      return res.status(404).json({ message: `No employee found with id ${cleanEmpId}.` });
    }

    res.json({
      ...updatedRow,
      empId: updatedRow.empId?.trim() || updatedRow.empId,
      empName: updatedRow.empName?.trim() || updatedRow.empName,
      department: updatedRow.department?.trim() || updatedRow.department,
      currentClass: DB_TO_LABEL[updatedRow.currentClass?.trim()] || updatedRow.currentClass?.trim(),
    });
  } catch (err) {
    console.error("POST /employeeupdation/employee-classes/update failed:", err);
    res.status(500).json({ message: err.message, code: err.code });
  }
});
module.exports = router;



