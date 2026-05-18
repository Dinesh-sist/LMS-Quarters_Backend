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

const RegisterEmployeeSchema = z.object({
  employeeId: z.string().min(1).max(50),
  dateOfBirth: z.string().min(1).max(32), // ISO date string (yyyy-mm-dd) from browser input
  employeeName: z.string().min(1).max(120),
  dateOfJoining: z.string().min(1).max(32),
  className: z.string().min(1).max(60),
  classChoice: z.string().min(1).max(60),
  mobile: z.string().min(5).max(20),
  email: z.string().email().max(64), // stored as Username in dbo.Users (nvarchar(64))
  password: z.string().min(6).max(128)
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

  let name = null;
  if (String(user.Role).toLowerCase() === "employee") {
    const details = await pool
      .request()
      .input("UserId", sql.Int, user.Id)
      .query("SELECT TOP 1 EmployeeName FROM dbo.UserDetails WHERE UserId=@UserId");
    name = details.recordset?.[0]?.EmployeeName || null;
  }

  return res.json({
    token,
    user: { id: user.Id, username: user.Username, role: user.Role, name }
  });
});

router.post("/register-employee", async (req, res) => {
  if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET not set" });

  const parsed = RegisterEmployeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const {
    employeeId,
    dateOfBirth,
    employeeName,
    dateOfJoining,
    className,
    classChoice,
    mobile,
    email,
    password
  } = parsed.data;

  const username = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 10);

  const pool = await getPool();

  // Ensure the details table exists.
  await pool.request().query(`
IF OBJECT_ID('dbo.UserDetails','U') IS NULL
BEGIN
  CREATE TABLE dbo.UserDetails (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    UserId INT NOT NULL UNIQUE,
    EmployeeId NVARCHAR(50) NOT NULL,
    DateOfBirth DATE NOT NULL,
    EmployeeName NVARCHAR(120) NOT NULL,
    DateOfJoining DATE NOT NULL,
    ClassName NVARCHAR(60) NOT NULL,
    ClassChoice NVARCHAR(60) NOT NULL,
    Mobile NVARCHAR(20) NOT NULL,
    Email NVARCHAR(120) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UserDetails_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UserDetails_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
  );
END
`);

  const exists = await pool
    .request()
    .input("Username", sql.NVarChar(64), username)
    .query("SELECT TOP 1 Id FROM dbo.Users WHERE Username=@Username");

  if (exists.recordset[0]) return res.status(409).json({ error: "Email already registered" });

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const userInsert = await new sql.Request(tx)
      .input("Username", sql.NVarChar(64), username)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .input("Role", sql.NVarChar(32), "employee")
      .query("INSERT INTO dbo.Users (Username, PasswordHash, Role) OUTPUT INSERTED.Id VALUES (@Username, @PasswordHash, @Role)");

    const userId = userInsert.recordset[0]?.Id;

    await new sql.Request(tx)
      .input("UserId", sql.Int, userId)
      .input("EmployeeId", sql.NVarChar(50), employeeId)
      .input("DateOfBirth", sql.Date, new Date(dateOfBirth))
      .input("EmployeeName", sql.NVarChar(120), employeeName)
      .input("DateOfJoining", sql.Date, new Date(dateOfJoining))
      .input("ClassName", sql.NVarChar(60), className)
      .input("ClassChoice", sql.NVarChar(60), classChoice)
      .input("Mobile", sql.NVarChar(20), mobile)
      .input("Email", sql.NVarChar(120), email)
      .query(
        "INSERT INTO dbo.UserDetails (UserId, EmployeeId, DateOfBirth, EmployeeName, DateOfJoining, ClassName, ClassChoice, Mobile, Email) VALUES (@UserId, @EmployeeId, @DateOfBirth, @EmployeeName, @DateOfJoining, @ClassName, @ClassChoice, @Mobile, @Email)"
      );

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return res.status(201).json({ ok: true });
});

module.exports = router;
