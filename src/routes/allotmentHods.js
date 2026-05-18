const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// Quarter allotment HOD departments (for outsider applications)
router.get("/", async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      "SELECT DISTINCT ALLOT_HOD_DEPT FROM dbo.Quarter_Allotment_HOD WHERE ALLOT_HOD_DEPT IS NOT NULL AND LTRIM(RTRIM(ALLOT_HOD_DEPT)) <> '' ORDER BY ALLOT_HOD_DEPT ASC"
    );

  const items = result.recordset.map((r) => ({ ALLOT_HOD_DEPT: r.ALLOT_HOD_DEPT }));
  return res.json({ items });
});

module.exports = router;

