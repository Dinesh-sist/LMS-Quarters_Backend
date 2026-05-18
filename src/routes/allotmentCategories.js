const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// Quarter allotment categories (outsider applications)
router.get("/", async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      "SELECT ALLOT_CAT_ID, ALLOT_CAT, ALLOT_CAT_PRIORITY FROM dbo.Quarter_Allotment_Category ORDER BY ALLOT_CAT_PRIORITY ASC, ALLOT_CAT ASC"
    );

  return res.json({ items: result.recordset });
});

module.exports = router;

