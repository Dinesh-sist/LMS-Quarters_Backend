const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      "SELECT Id, QuarterNo, QuarterType, Location, IsAvailable, CreatedAt FROM dbo.Quarters ORDER BY Id DESC"
    );
  return res.json({ items: result.recordset });
});

module.exports = router;

