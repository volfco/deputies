ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role text;
UPDATE auth_users SET role = 'admin' WHERE role IS NULL;
ALTER TABLE auth_users ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE auth_users ALTER COLUMN role SET NOT NULL;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check CHECK (role IN ('admin', 'viewer'));
