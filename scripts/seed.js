require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getPool, sql } = require("../src/db");

async function upsertUser(pool, username, password, role) {
  const passwordHash = await bcrypt.hash(password, 10);
  await pool
    .request()
    .input("Username", sql.NVarChar(64), username)
    .input("PasswordHash", sql.NVarChar(255), passwordHash)
    .input("Role", sql.NVarChar(32), role)
    .query(
      `
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username=@Username)
  UPDATE dbo.Users SET PasswordHash=@PasswordHash, Role=@Role WHERE Username=@Username;
ELSE
  INSERT INTO dbo.Users (Username, PasswordHash, Role) VALUES (@Username, @PasswordHash, @Role);
`
    );
}

async function main() {
  const pool = await getPool();
  await upsertUser(pool, "admin", "admin123", "admin");
  await upsertUser(pool, "employee", "employee123", "employee");

  await pool.request().query(
    `
IF NOT EXISTS (SELECT 1 FROM dbo.Quarters WHERE QuarterNo='Q-101')
  INSERT INTO dbo.Quarters (QuarterNo, QuarterType, Location, IsAvailable) VALUES ('Q-101','Type-A','Colony-1',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Quarters WHERE QuarterNo='Q-102')
  INSERT INTO dbo.Quarters (QuarterNo, QuarterType, Location, IsAvailable) VALUES ('Q-102','Type-A','Colony-1',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Quarters WHERE QuarterNo='Q-201')
  INSERT INTO dbo.Quarters (QuarterNo, QuarterType, Location, IsAvailable) VALUES ('Q-201','Type-B','Colony-2',1);
`
  );

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

