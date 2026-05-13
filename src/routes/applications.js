const express = require("express");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const CreateSchema = z.object({
  quarterId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(400).optional()
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const userId = Number(req.user.sub);
  const { quarterId = null, notes = null } = parsed.data;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("UserId", sql.Int, userId)
    .input("QuarterId", sql.Int, quarterId)
    .input("Notes", sql.NVarChar(400), notes)
    .query(
      "INSERT INTO dbo.Applications (UserId, QuarterId, Status, Notes) OUTPUT INSERTED.Id VALUES (@UserId, @QuarterId, 'pending', @Notes)"
    );

  return res.status(201).json({ id: result.recordset[0]?.Id });
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = Number(req.user.sub);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("UserId", sql.Int, userId)
    .query(
      "SELECT a.Id, a.Status, a.Notes, a.CreatedAt, a.UpdatedAt, q.QuarterNo, q.QuarterType, q.Location FROM dbo.Applications a LEFT JOIN dbo.Quarters q ON q.Id=a.QuarterId WHERE a.UserId=@UserId ORDER BY a.Id DESC"
    );
  return res.json({ items: result.recordset });
});

module.exports = router;

