require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getPool, sql } = require("../src/db");

async function main() {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash("admin123", 10);

  await pool
    .request()
    .input("Username", sql.NVarChar(64), "admin")
    .input("PasswordHash", sql.NVarChar(255), passwordHash)
    .input("Role", sql.NVarChar(32), "admin")
    .query(`
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username=@Username)
  UPDATE dbo.Users SET PasswordHash=@PasswordHash, Role=@Role WHERE Username=@Username;
ELSE
  INSERT INTO dbo.Users (Username, PasswordHash, Role) VALUES (@Username, @PasswordHash, @Role);
`);

  console.log("✅ Admin user upserted successfully.");
  console.log("   Username : admin");
  console.log("   Password : admin123");
  console.log("   Role     : admin");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});









