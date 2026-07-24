const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { jwtSecret } = require("../config");
const { sendPasswordResetOtpEmail } = require("../Mailer");

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

const RequestPasswordOtpSchema = z.object({
  identifier: z.string().min(1).max(120)
});

const VerifyPasswordOtpSchema = z.object({
  identifier: z.string().min(1).max(120),
  otp: z.string().regex(/^\d{6}$/)
});

const ResetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(6).max(128)
});

async function ensurePasswordResetOtpTable(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.PasswordResetOtps','U') IS NULL
BEGIN
  CREATE TABLE dbo.PasswordResetOtps (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT NOT NULL,
    OtpHash NVARCHAR(255) NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    UsedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PasswordResetOtps_Users
      FOREIGN KEY (UserId)
      REFERENCES dbo.Users(Id)
      ON DELETE CASCADE
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_PasswordResetOtps_UserId_ExpiresAt'
    AND object_id = OBJECT_ID('dbo.PasswordResetOtps')
)
BEGIN
  CREATE INDEX IX_PasswordResetOtps_UserId_ExpiresAt
  ON dbo.PasswordResetOtps (UserId, ExpiresAt DESC);
END;
`);
}

async function findPasswordResetUser(pool, rawIdentifier) {
  const identifier = String(rawIdentifier || "").trim();
  const normalizedEmail = identifier.toLowerCase();

  const result = await pool.request()
    .input("Identifier", sql.NVarChar(120), identifier)
    .input("Email", sql.NVarChar(120), normalizedEmail)
    .query(`
      SELECT TOP 1
        u.Id,
        u.Username,
        u.Role,
        ud.EmployeeId,
        ud.EmployeeName,
        ud.Email
      FROM dbo.Users u
      LEFT JOIN dbo.UserDetails ud ON ud.UserId = u.Id
      WHERE LOWER(LTRIM(RTRIM(u.Username))) = @Email
         OR LOWER(LTRIM(RTRIM(ud.Email))) = @Email
         OR LTRIM(RTRIM(ud.EmployeeId)) = @Identifier
      ORDER BY u.Id DESC
    `);

  return result.recordset?.[0] || null;
}

function getOtpRecipient(user) {
  const detailEmail = String(user?.Email || "").trim();
  const username = String(user?.Username || "").trim();
  if (detailEmail.includes("@")) return detailEmail;
  if (username.includes("@")) return username;
  return "";
}

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
    EmpClass NVARCHAR(60) NOT NULL,
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

  const empCheck = await pool
    .request()
    .input("EmployeeId", sql.NVarChar(50), employeeId)
    .input("DateOfBirth", sql.NVarChar(10), dateOfBirth)
    .query("SELECT TOP 1 UserId FROM dbo.UserDetails WHERE EmployeeId=@EmployeeId AND CONVERT(varchar(10), DateOfBirth, 23) = @DateOfBirth");

  const userId = empCheck.recordset[0]?.UserId;
  if (!userId) {
    return res.status(404).json({ error: "Invalid Employee ID or Date of Birth" });
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input("Id", sql.Int, userId)
      .input("Username", sql.NVarChar(64), username)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .query("UPDATE dbo.Users SET Username=@Username, PasswordHash=@PasswordHash WHERE Id=@Id");

    await new sql.Request(tx)
      .input("UserId", sql.Int, userId)
      .input("EmployeeName", sql.NVarChar(120), employeeName)
      .input("DateOfJoining", sql.Date, new Date(dateOfJoining))
      .input("EmpClass", sql.NVarChar(60), className)
      .input("Mobile", sql.NVarChar(20), mobile)
      .input("Email", sql.NVarChar(120), email)
      .query(
        "UPDATE dbo.UserDetails SET EmployeeName=@EmployeeName, DateOfJoining=@DateOfJoining, EmpClass=@EmpClass, Mobile=@Mobile, Email=@Email WHERE UserId=@UserId"
      );

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return res.status(200).json({ ok: true });
});

router.post("/forgot-password/request-otp", async (req, res) => {
  const parsed = RequestPasswordOtpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const pool = await getPool();
  await ensurePasswordResetOtpTable(pool);

  const user = await findPasswordResetUser(pool, parsed.data.identifier);
  if (!user) {
    return res.status(404).json({ error: "No employee found for this email or Employee ID." });
  }

  const recipient = getOtpRecipient(user);
  if (!recipient) {
    return res.status(400).json({ error: "No email address is available for this employee." });
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = await bcrypt.hash(otp, 10);

  await pool.request()
    .input("UserId", sql.Int, user.Id)
    .query(`
      UPDATE dbo.PasswordResetOtps
      SET UsedAt = SYSUTCDATETIME()
      WHERE UserId = @UserId AND UsedAt IS NULL;
    `);

  await pool.request()
    .input("UserId", sql.Int, user.Id)
    .input("OtpHash", sql.NVarChar(255), otpHash)
    .query(`
      INSERT INTO dbo.PasswordResetOtps (UserId, OtpHash, ExpiresAt)
      VALUES (@UserId, @OtpHash, DATEADD(MINUTE, 10, SYSUTCDATETIME()));
    `);

  await sendPasswordResetOtpEmail(recipient, user.EmployeeName, otp);

  return res.json({
    ok: true,
    message: "OTP sent to the registered email address."
  });
});

router.post("/forgot-password/verify-otp", async (req, res) => {
  if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET not set" });

  const parsed = VerifyPasswordOtpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const pool = await getPool();
  await ensurePasswordResetOtpTable(pool);

  const user = await findPasswordResetUser(pool, parsed.data.identifier);
  if (!user) return res.status(404).json({ error: "No employee found for this email or Employee ID." });

  const otpResult = await pool.request()
    .input("UserId", sql.Int, user.Id)
    .query(`
      SELECT TOP 1 Id, OtpHash
      FROM dbo.PasswordResetOtps
      WHERE UserId = @UserId
        AND UsedAt IS NULL
        AND ExpiresAt > SYSUTCDATETIME()
      ORDER BY CreatedAt DESC
    `);

  const otpRow = otpResult.recordset?.[0];
  if (!otpRow) return res.status(400).json({ error: "OTP expired or not found. Please request a new OTP." });

  const isValidOtp = await bcrypt.compare(parsed.data.otp, otpRow.OtpHash);
  if (!isValidOtp) return res.status(400).json({ error: "Invalid OTP." });

  const resetToken = jwt.sign(
    { sub: String(user.Id), otpId: otpRow.Id, purpose: "password-reset" },
    jwtSecret,
    { expiresIn: "10m" }
  );

  return res.json({ ok: true, resetToken });
});

router.post("/forgot-password/reset", async (req, res) => {
  if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET not set" });

  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  let decoded;
  try {
    decoded = jwt.verify(parsed.data.resetToken, jwtSecret);
  } catch (_) {
    return res.status(401).json({ error: "Reset session expired. Please request a new OTP." });
  }

  if (decoded?.purpose !== "password-reset" || !decoded?.sub || !decoded?.otpId) {
    return res.status(401).json({ error: "Invalid reset session." });
  }

  const userId = Number(decoded.sub);
  const otpId = Number(decoded.otpId);
  if (!Number.isInteger(userId) || !Number.isInteger(otpId)) {
    return res.status(401).json({ error: "Invalid reset session." });
  }

  const pool = await getPool();
  await ensurePasswordResetOtpTable(pool);

  const otpResult = await pool.request()
    .input("OtpId", sql.Int, otpId)
    .input("UserId", sql.Int, userId)
    .query(`
      SELECT TOP 1 Id
      FROM dbo.PasswordResetOtps
      WHERE Id = @OtpId
        AND UserId = @UserId
        AND UsedAt IS NULL
        AND ExpiresAt > SYSUTCDATETIME()
    `);

  if (!otpResult.recordset?.[0]) {
    return res.status(400).json({ error: "OTP expired or already used. Please request a new OTP." });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    await new sql.Request(tx)
      .input("UserId", sql.Int, userId)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .query("UPDATE dbo.Users SET PasswordHash = @PasswordHash WHERE Id = @UserId");

    await new sql.Request(tx)
      .input("OtpId", sql.Int, otpId)
      .query("UPDATE dbo.PasswordResetOtps SET UsedAt = SYSUTCDATETIME() WHERE Id = @OtpId");

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return res.json({ ok: true, message: "Password reset successfully." });
});

module.exports = router;
