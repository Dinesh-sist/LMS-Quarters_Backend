const express = require("express");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/classes", async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      "SELECT Class_PRIORITY, class_name, [Class] FROM dbo.Quarter_Emp_Class WHERE class_name IS NOT NULL AND LTRIM(RTRIM(class_name)) <> '' ORDER BY Class_PRIORITY ASC, class_name ASC"
    );
  return res.json({ items: result.recordset });
});

const LookupSchema = z.object({
  employeeId: z.string().min(1).max(50),
  dateOfBirth: z.string().min(1).max(32), 
});


async function getTableColumns(pool, table) {
  const result = await pool
    .request()
    .input("TableName", sql.NVarChar(100), table)
    .query(`
      SELECT
        MAX(CASE WHEN COLUMN_NAME = 'Type' THEN 1 ELSE 0 END) AS hasType,
        MAX(CASE WHEN COLUMN_NAME = 'CAST' THEN 1 ELSE 0 END) AS hasCast
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @TableName
    `);
  return result.recordset[0]; // { hasType: 0|1, hasCast: 0|1 }
}

async function tryFindInTable(pool, table, employeeId, dob) {
  
  const { hasType, hasCast } = await getTableColumns(pool, table);

  const typeCol = hasType
    ? "CAST(Type AS NVARCHAR(100)) AS Type"
    : "NULL AS Type";
  const castCol = hasCast
    ? "CAST([CAST] AS NVARCHAR(100)) AS [CAST]"
    : "NULL AS [CAST]";

  const result = await pool
    .request()
    .input("EmpNo", sql.NVarChar(50), employeeId)
    .input("Dob", sql.Date, new Date(dob))
    .query(
      `SELECT TOP 1 EMP_NO, EMP_NM, BIRTH_DT, JOIN_DT, ${typeCol}, ${castCol}
       FROM dbo.${table}
       WHERE EMP_NO=@EmpNo AND BIRTH_DT=@Dob`
    );

  const row = result.recordset?.[0];
  if (!row) return null;
  return { table, row };
}

function classFromTableName(table) {
  const m = String(table || "").match(/class\s*([1-4])/i);
  if (!m) return null;
  return Number(m[1]);
}

async function findQuarterEmpClass(pool, { classNo, type }) {
  if (classNo === 1) {
    const isSr = String(type || "").toLowerCase().startsWith("sr");
    const priority = isSr ? 1 : 2;
    const result = await pool
      .request()
      .input("Priority", sql.Int, priority)
      .query(
        "SELECT TOP 1 Class_ID, Class_PRIORITY, class_name, [Class] FROM dbo.Quarter_Emp_Class WHERE Class_PRIORITY=@Priority"
      );
    return result.recordset?.[0] || null;
  }

  // Try by class name first
  const byName = await pool
    .request()
    .input("LikeName", sql.NVarChar(40), `%class${classNo}%`)
    .query(
      "SELECT TOP 1 Class_ID, Class_PRIORITY, class_name, [Class] FROM dbo.Quarter_Emp_Class WHERE LOWER(class_name) LIKE LOWER(@LikeName) ORDER BY Class_PRIORITY ASC"
    );
  if (byName.recordset?.[0]) return byName.recordset[0];

  const byClass = await pool
    .request()
    .input("ClassName", sql.NVarChar(40), `%CLASS-${toRoman(classNo)}%`)
    .query(
      "SELECT TOP 1 Class_ID, Class_PRIORITY, class_name, [Class] FROM dbo.Quarter_Emp_Class WHERE UPPER([Class]) LIKE UPPER(@ClassName) ORDER BY Class_PRIORITY ASC"
    );
  if (byClass.recordset?.[0]) return byClass.recordset[0];

  return null;
}

function toRoman(n) {
  const map = { 1: "I", 2: "II", 3: "III", 4: "IV" };
  return map[n] || String(n);
}

router.post("/lookup", async (req, res) => {
  const parsed = LookupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const employeeId = parsed.data.employeeId.trim();
  const dateOfBirth = parsed.data.dateOfBirth;

  const pool = await getPool();

  const result = await pool.request()
    .input("EmployeeId", sql.NVarChar(50), employeeId)
    .input("DateOfBirth", sql.NVarChar(10), dateOfBirth)
    .query(`
      SELECT ud.UserId, ud.EmployeeName, ud.EmpClass, ud.DateOfJoining, u.Username
      FROM dbo.UserDetails ud
      INNER JOIN dbo.Users u ON ud.UserId = u.Id
      WHERE ud.EmployeeId = @EmployeeId AND CONVERT(varchar(10), ud.DateOfBirth, 23) = @DateOfBirth
    `);

  const row = result.recordset?.[0];
  
  if (!row) {
    return res.status(404).json({ error: "Invalid Employee ID or Date of Birth" });
  }

  if (row.Username && row.Username.includes('@')) {
    return res.status(409).json({ error: "You are already registered! Please login." });
  }

  return res.json({
    employeeId: employeeId,
    employeeName: row.EmployeeName,
    dateOfBirth: dateOfBirth,
    dateOfJoining: row.DateOfJoining
      ? new Date(row.DateOfJoining).toISOString().slice(0, 10)
      : "",
    className: row.EmpClass || "",
    classChoice: row.EmpClass || "",
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = Number(req.user.sub);
  if (!Number.isFinite(userId))
    return res.status(400).json({ error: "Invalid user" });

  const pool = await getPool();

  const details = await pool
    .request()
    .input("UserId", sql.Int, userId)
    .query(
      "SELECT EmployeeId, DateOfBirth, EmployeeName, DateOfJoining, GradDate, EmpClass, Mobile, Email, DPT_NM AS Department, Category, DebarredFromDate, DebarredToDate, area_type, Quarter_no FROM dbo.UserDetails WHERE UserId=@UserId"
    );

  const row = details.recordset?.[0];
  if (!row) return res.status(404).json({ error: "User details not found" });

  const className = String(row.EmpClass || "").trim();
  // No single-class-ID lookup needed — classOfEmployee is passed directly to the vacant endpoint
  // so ALL quarter types for that class are fetched (not just one).

  // Try to find Type and Caste from legacy tables if they exist
  let type = "";
  let casteOfEmployee = "GENERAL";

  const dobForLookup = row.DateOfBirth;
  const empIdForLookup = row.EmployeeId;

  if (empIdForLookup && dobForLookup) {
    const tables = ["Class1", "Class2", "Class3", "Class4"];
    for (const table of tables) {
      try {
        const found = await tryFindInTable(pool, table, empIdForLookup, dobForLookup);
        if (found && found.row) {
          type = found.row.Type ?? "";
          const castRaw = found.row.CAST == null ? "" : String(found.row.CAST).trim().toUpperCase();
          casteOfEmployee = castRaw === "SC" ? "SC" : castRaw === "ST" ? "ST" : "GENERAL";
          break;
        }
      } catch (err) {
        console.warn(`Skipping table ${table} for caste lookup:`, err.message);
      }
    }
  }

  // Format dates for the JSON response safely
  const formatDOB = row.DateOfBirth ? 
    `${row.DateOfBirth.getFullYear()}-${String(row.DateOfBirth.getMonth() + 1).padStart(2, '0')}-${String(row.DateOfBirth.getDate()).padStart(2, '0')}` : "";
  
  const formatDOJ = row.DateOfJoining ? 
    `${row.DateOfJoining.getFullYear()}-${String(row.DateOfJoining.getMonth() + 1).padStart(2, '0')}-${String(row.DateOfJoining.getDate()).padStart(2, '0')}` : "";

  const formatGradDate = row.GradDate ? 
    `${row.GradDate.getFullYear()}-${String(row.GradDate.getMonth() + 1).padStart(2, '0')}-${String(row.GradDate.getDate()).padStart(2, '0')}` : "";

  const formatDebarredFromDate = row.DebarredFromDate ? 
    `${row.DebarredFromDate.getFullYear()}-${String(row.DebarredFromDate.getMonth() + 1).padStart(2, '0')}-${String(row.DebarredFromDate.getDate()).padStart(2, '0')}` : "";
    
  const formatDebarredToDate = row.DebarredToDate ? 
    `${row.DebarredToDate.getFullYear()}-${String(row.DebarredToDate.getMonth() + 1).padStart(2, '0')}-${String(row.DebarredToDate.getDate()).padStart(2, '0')}` : "";

  return res.json({
    employeeId: row.EmployeeId || "",
    employeeName: row.EmployeeName || "",
    dateOfBirth: formatDOB,
    dateOfJoining: formatDOJ,
    gradDate: formatGradDate,
    type: type,
    classOfEmployee: row.EmpClass || "",
    casteOfEmployee: casteOfEmployee,
    category: row.Category || "",
    department: row.Department || "",
    debarredFromDate: formatDebarredFromDate,
    debarredToDate: formatDebarredToDate,
    areaType: row.area_type || "",
    quarterNo: row.Quarter_no || "",
  });
});

module.exports = router;