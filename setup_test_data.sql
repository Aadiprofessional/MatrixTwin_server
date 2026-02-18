-- Insert test user with the specified UUID
INSERT INTO users (id, name, email, role, created_at, updated_at)
VALUES (
    '5fcf581f-f854-459b-b521-aae507891337',
    'Test Admin User',
    'testadmin@example.com',
    'admin',
    NOW(),
    NOW()
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    updated_at = NOW();

-- Insert a test project
INSERT INTO projects (id, name, description, created_by, created_at, updated_at)
VALUES (
    'test-project-1',
    'Test Project',
    'A test project for API testing',
    '5fcf581f-f854-459b-b521-aae507891337',
    NOW(),
    NOW()
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = NOW();

-- Insert additional test users for workflow testing
INSERT INTO users (id, name, email, role, created_at, updated_at)
VALUES 
    ('test-user-2', 'Test User 2', 'testuser2@example.com', 'user', NOW(), NOW()),
    ('test-user-3', 'Test User 3', 'testuser3@example.com', 'user', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    updated_at = NOW(); 