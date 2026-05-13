const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { jwtSecret } = require("../config");

const router = express.Router();

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128)
});

router.post("/login", async (req, res) => {
  if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET not set" });

  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { username, password } = parsed.data;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("Username", sql.NVarChar(64), username)
    .query("SELECT TOP 1 Id, Username, PasswordHash, Role FROM dbo.Users WHERE Username=@Username");

  const user = result.recordset[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.PasswordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { sub: String(user.Id), username: user.Username, role: user.Role },
    jwtSecret,
    { expiresIn: "8h" }
  );

  return res.json({ token, user: { id: user.Id, username: user.Username, role: user.Role } });
});

module.exports = router;

