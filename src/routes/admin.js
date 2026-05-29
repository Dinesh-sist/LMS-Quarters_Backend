const express = require("express");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(
    "SELECT a.Id, a.Status, a.Notes, a.CreatedAt, a.UpdatedAt, u.Username, u.Role, q.QuarterNo, q.QuarterType, q.Location FROM dbo.Applications a JOIN dbo.Users u ON u.Id=a.UserId LEFT JOIN dbo.Quarters q ON q.Id=a.QuarterId ORDER BY a.Id DESC"
  );
  return res.json({ items: result.recordset });
});

router.get("/verify-quarter-applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id,
      appNo,
      empId,
      empName,
      [class],
      CONVERT(varchar(10), gradDate, 23) AS gradDate,
      CONVERT(varchar(10), dateOfJoin, 23) AS dateOfJoin,
      basic,
      CONVERT(varchar(10), dob, 23) AS dob,
      dept,
      casteID,
      currentQtr,
      currentQtrType,
      requestedQtr,
      requestedQtrLocation,
      requestedQtrType,
      exchangeQtr,
      proofFile,
      CONVERT(varchar(10), requestedDate, 23) AS requestedDate,
      stage
    FROM dbo.VerifyQuarterApplications
    ORDER BY appNo DESC
  `);
  return res.json({ items: result.recordset });
});

router.get("/status-of-applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id,
      appNo,
      empId,
      empName,
      [class],
      CONVERT(varchar(10), gradDate, 23) AS gradDate,
      CONVERT(varchar(10), dateOfJoin, 23) AS dateOfJoin,
      basic,
      CONVERT(varchar(10), dob, 23) AS dob,
      dept,
      casteId,
      currentQtr,
      currentQtyType,
      reqQtr,
      reqQtrLocation,
      reqQtrType,
      exchange,
      proofFile,
      CONVERT(varchar(10), reqDate, 23) AS reqDate,
      rosterNo,
      result
    FROM dbo.StatusOfApplications
    ORDER BY appNo DESC
  `);
  return res.json({ items: result.recordset });
});

router.get("/house-allotment-committee-history", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id,
      CONVERT(varchar(10), committeeHeld, 23) AS committeeHeld,
      remarks
    FROM dbo.HouseAllotmentCommitteeHistory
    ORDER BY committeeHeld DESC
  `);
  return res.json({ items: result.recordset });
});

const UpdateStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  notes: z.string().max(400).optional()
});

router.patch("/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { status, notes } = parsed.data;
  const pool = await getPool();

  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.NVarChar(24), status)
    .input("Notes", sql.NVarChar(400), notes ?? null)
    .query(
      "UPDATE dbo.Applications SET Status=@Status, Notes=COALESCE(@Notes, Notes), UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id; SELECT @@ROWCOUNT AS Affected"
    );

  const affected = result.recordset[0]?.Affected ?? 0;
  if (!affected) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

module.exports = router;
