-- Owner: Get all projects (bypassing RLS)
CREATE OR REPLACE FUNCTION get_all_projects_owner()
RETURNS SETOF projects
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM projects ORDER BY created_at DESC;
$$;

-- Admin: Get company projects (bypassing RLS)
CREATE OR REPLACE FUNCTION get_company_projects(p_company_id uuid)
RETURNS SETOF projects
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM projects WHERE company_id = p_company_id ORDER BY created_at DESC;
$$;

-- Member: Get assigned projects (bypassing RLS)
CREATE OR REPLACE FUNCTION get_member_projects(p_user_id uuid, p_company_id uuid)
RETURNS SETOF projects
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* 
  FROM projects p
  INNER JOIN project_members pm ON p.id = pm.project_id
  WHERE pm.user_id = p_user_id AND p.company_id = p_company_id
  ORDER BY p.created_at DESC;
$$;
