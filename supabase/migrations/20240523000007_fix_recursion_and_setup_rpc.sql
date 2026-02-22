-- Fix RLS recursion by using users table for role/company info and create RPC

BEGIN;

-- 1. Drop existing policies to remove recursive logic
DROP POLICY IF EXISTS "Admins/Owners can manage projects" ON projects;
DROP POLICY IF EXISTS "Members can view assigned projects" ON projects;
DROP POLICY IF EXISTS "Admins/Owners can manage project members" ON project_members;
DROP POLICY IF EXISTS "Members can view their own membership" ON project_members;
DROP POLICY IF EXISTS "Users can view own membership" ON project_members;
DROP POLICY IF EXISTS "Admins can manage company projects" ON projects;
DROP POLICY IF EXISTS "Users can view assigned projects" ON projects;
DROP POLICY IF EXISTS "Users can view own project membership" ON project_members;
DROP POLICY IF EXISTS "Admins can manage project members" ON project_members;

-- 2. Create optimized policies using users table
-- Projects Policies
-- Admin: Access all projects in their company (using users table)
CREATE POLICY "Admins can manage company projects" ON projects
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role = 'admin' 
            AND company_id = projects.company_id
        )
    );

-- User: Access only assigned projects
CREATE POLICY "Users can view assigned projects" ON projects
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members 
            WHERE project_id = projects.id 
            AND user_id = auth.uid()
        )
    );

-- Project Members Policies
-- User: View own membership
CREATE POLICY "Users can view own project membership" ON project_members
    FOR SELECT
    USING ( user_id = auth.uid() );

-- Admin: Manage all project members in their company
CREATE POLICY "Admins can manage project members" ON project_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE id = project_members.project_id
            AND company_id IN (
                SELECT company_id FROM users 
                WHERE id = auth.uid() AND role = 'admin'
            )
        )
    );

-- 3. Create RPC function to get projects for user securely (Backup for RLS issues)
CREATE OR REPLACE FUNCTION get_user_projects_v2(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    company_id UUID,
    name TEXT,
    description TEXT,
    status TEXT,
    location TEXT,
    client TEXT,
    deadline TIMESTAMPTZ,
    image_url TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    user_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_role TEXT;
    v_company_id UUID;
BEGIN
    -- Get user role and company
    SELECT role, company_id INTO v_user_role, v_company_id
    FROM users
    WHERE id = p_user_id;

    IF v_user_role = 'admin' THEN
        -- Admin sees all projects in company
        RETURN QUERY
        SELECT 
            p.id, p.company_id, p.name, p.description, p.status, 
            p.location, p.client, p.deadline, p.image_url, 
            p.created_by, p.created_at, p.updated_at,
            'admin'::text as user_role
        FROM projects p
        WHERE p.company_id = v_company_id
        ORDER BY p.created_at DESC;
    ELSE
        -- User sees only assigned projects
        RETURN QUERY
        SELECT 
            p.id, p.company_id, p.name, p.description, p.status, 
            p.location, p.client, p.deadline, p.image_url, 
            p.created_by, p.created_at, p.updated_at,
            pm.role as user_role
        FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE p.company_id = v_company_id
        AND pm.user_id = p_user_id
        ORDER BY p.created_at DESC;
    END IF;
END;
$$;

COMMIT;
