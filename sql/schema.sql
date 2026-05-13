IF OBJECT_ID('dbo.Applications', 'U') IS NOT NULL DROP TABLE dbo.Applications;
IF OBJECT_ID('dbo.Quarters', 'U') IS NOT NULL DROP TABLE dbo.Quarters;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;

CREATE TABLE dbo.Users (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  Username NVARCHAR(64) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  Role NVARCHAR(32) NOT NULL, -- 'admin' | 'employee' | 'estate_officer' | 'finance' | 'technical'
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Quarters (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  QuarterNo NVARCHAR(50) NOT NULL UNIQUE,
  QuarterType NVARCHAR(50) NULL,
  Location NVARCHAR(100) NULL,
  IsAvailable BIT NOT NULL DEFAULT 1,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Applications (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  UserId INT NOT NULL,
  QuarterId INT NULL,
  Status NVARCHAR(24) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  Notes NVARCHAR(400) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_Applications_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id),
  CONSTRAINT FK_Applications_Quarters FOREIGN KEY (QuarterId) REFERENCES dbo.Quarters(Id)
);

GO

-- Optional seed (run after `npm i`):
--   npm run seed
