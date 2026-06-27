const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// The single source table for all dashboard charts.
const TABLE = "[LMSQuartersNew].[dbo].[StatusOfApplications]";

// Fold whatever the `result` column contains into the 3 buckets the pie needs.
function bucketStatus(rows) {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  rows.forEach((row) => {
    const key = String(row.status || "").toLowerCase();
    if (key.startsWith("approv")) counts.approved += row.count;
    else if (key.startsWith("reject")) counts.rejected += row.count;
    else counts.pending += row.count;
  });
  return counts;
}

// ─────────────────────────────────────────────────────────────────────
// ESTATE QUARTERS - Total Count
// ─────────────────────────────────────────────────────────────────────
router.get("/estate-quarters/total-count", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT COUNT(*) AS total FROM Estate_Quarters`
    );
    return res.json({ total: result.recordset[0]?.total || 0 });
  } catch (err) {
    console.error("Total quarters count error:", err);
    return res.status(500).json({ error: "Failed to fetch total quarters" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// ESTATE QUARTERS - Status Counts (Occupied, Vacant, Beyond Repair)
// ─────────────────────────────────────────────────────────────────────
router.get("/estate-quarters/status-counts", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT 
        SUM(CASE WHEN STATUS1 = 'Occupied' THEN 1 ELSE 0 END) AS occupied,
        SUM(CASE WHEN STATUS1 = 'Vacant' THEN 1 ELSE 0 END) AS vacant,
        SUM(CASE WHEN STATUS1 = 'Beyond Repair' THEN 1 ELSE 0 END) AS beyondRepair
       FROM Estate_Quarters`
    );
    const row = result.recordset[0];
    return res.json({
      occupied: row?.occupied || 0,
      vacant: row?.vacant || 0,
      beyondRepair: row?.beyondRepair || 0,
    });
  } catch (err) {
    console.error("Status counts error:", err);
    return res.status(500).json({ error: "Failed to fetch status counts" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// EMPLOYEES BY QUARTER TYPE
// ─────────────────────────────────────────────────────────────────────
router.get("/estate-quarters/employees-by-type", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT LTRIM(RTRIM(T.QTR_TYPE)) AS type, COUNT(U.Category) AS count
       FROM Quarter_Allotment_Type T
       LEFT JOIN UserDetails U ON LTRIM(RTRIM(T.QTR_TYPE)) = LTRIM(RTRIM(U.Category))
       GROUP BY LTRIM(RTRIM(T.QTR_TYPE))
       ORDER BY count DESC, type ASC`
    );
    return res.json(result.recordset);
  } catch (err) {
    console.error("Employees by quarter type error:", err);
    return res.status(500).json({ error: "Failed to fetch quarter type data" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// EMPLOYEES BY CLASS
// ─────────────────────────────────────────────────────────────────────
router.get("/employees/count-by-class", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT LTRIM(RTRIM([ClassName])) AS className, COUNT(*) AS count
     FROM UserDetails
     WHERE [ClassName] IS NOT NULL AND LTRIM(RTRIM([ClassName])) <> ''
     GROUP BY LTRIM(RTRIM([ClassName]))
     ORDER BY count DESC`
    );
    return res.json(result.recordset);
  } catch (err) {
    console.error("Employees by class error:", err);
    return res.status(500).json({ error: "Failed to fetch class data" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// APPLICATIONS BY STATUS
// ─────────────────────────────────────────────────────────────────────
router.get("/applications/status-counts", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const Status = await pool.request().query(
      `SELECT
         CASE WHEN [Status] IS NULL OR LTRIM(RTRIM([Status])) = ''
              THEN 'Pending' ELSE LTRIM(RTRIM([Status])) END AS status,
         COUNT(*) AS count
       FROM Quarter_Applications
       GROUP BY CASE WHEN [Status] IS NULL OR LTRIM(RTRIM([Status])) = ''
                     THEN 'Pending' ELSE LTRIM(RTRIM([Status])) END`
    );

    const counts = bucketStatus(Status.recordset);
    return res.json({
      pending: counts.pending,
      approved: counts.approved,
      rejected: counts.rejected,
    });
  } catch (err) {
    console.error("Applications by status error:", err);
    return res.status(500).json({ error: "Failed to fetch applications status data" });
  }
});

module.exports = router;