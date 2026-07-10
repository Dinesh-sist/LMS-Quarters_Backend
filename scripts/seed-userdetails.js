require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getPool, sql } = require("../src/db");

async function insertEmployee({ employeeId, name, dob, doj, empClass, category, mobile, email, username }) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash("changeme123", 10);

  // 1. Upsert into dbo.Users
  const userResult = await pool
    .request()
    .input("Username", sql.NVarChar(64), username)
    .input("PasswordHash", sql.NVarChar(255), passwordHash)
    .input("Role", sql.NVarChar(32), "employee")
    .query(`
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username = @Username)
  SELECT Id FROM dbo.Users WHERE Username = @Username;
ELSE BEGIN
  INSERT INTO dbo.Users (Username, PasswordHash, Role) VALUES (@Username, @PasswordHash, @Role);
  SELECT SCOPE_IDENTITY() AS Id;
END
`);

  const userId = userResult.recordset[0]?.Id;
  if (!userId) throw new Error(`Could not get UserId for ${username}`);

  // 2. Upsert into dbo.UserDetails
  await pool
    .request()
    .input("UserId",       sql.Int,          userId)
    .input("EmployeeId",   sql.NVarChar(50),  employeeId)
    .input("DateOfBirth",  sql.Date,          new Date(dob))
    .input("EmployeeName", sql.NVarChar(120), name)
    .input("DateOfJoining",sql.Date,          new Date(doj))
    .input("EmpClass",     sql.NVarChar(60),  empClass)
    .input("Category",     sql.NVarChar(60),  category)
    .input("Mobile",       sql.NVarChar(20),  mobile)
    .input("Email",        sql.NVarChar(120), email)
    .query(`
IF EXISTS (SELECT 1 FROM dbo.UserDetails WHERE UserId = @UserId)
  UPDATE dbo.UserDetails
    SET EmployeeId   = @EmployeeId,
        DateOfBirth  = @DateOfBirth,
        EmployeeName = @EmployeeName,
        DateOfJoining= @DateOfJoining,
        EmpClass     = @EmpClass,
        Category     = @Category,
        Mobile       = @Mobile,
        Email        = @Email
    WHERE UserId = @UserId;
ELSE
  INSERT INTO dbo.UserDetails
    (UserId, EmployeeId, DateOfBirth, EmployeeName, DateOfJoining, EmpClass, Category, Mobile, Email)
  VALUES
    (@UserId, @EmployeeId, @DateOfBirth, @EmployeeName, @DateOfJoining, @EmpClass, @Category, @Mobile, @Email);
`);

  console.log(`✅ Inserted/Updated: ${name} (${employeeId}) | Mobile: ${mobile} | Email: ${email}`);
}

async function main() {
  // ── Record 1: Full details ───────────────────────────────────────────────
  await insertEmployee({
    employeeId:  "EMP001",
    name:        "Rajesh Kumar",
    dob:         "1985-06-15",
    doj:         "2010-03-01",
    empClass:    "Class III",
    category:    "Type-B",
    mobile:      "9876543210",
    email:       "rajesh.kumar@example.com",
    username:    "rajesh.kumar@example.com"
  });

  // ── Record 2: No mobile / email (placeholder used for NOT NULL constraint) ──
  await insertEmployee({
    employeeId:  "EMP002",
    name:        "Priya Sharma",
    dob:         "1990-11-22",
    doj:         "2015-07-10",
    empClass:    "Class II",
    category:    "Type-A",
    mobile:      "N/A",      // no mobile provided
    email:       "N/A",      // no email provided
    username:    "EMP002"    // using Employee ID as username since no email
  });

  console.log("\n✅ All records inserted successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
