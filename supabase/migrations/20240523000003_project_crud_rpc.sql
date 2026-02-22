-- Function to get project by ID (bypassing RLS)
CREATE OR REPLACE FUNCTION get_project_by_id(p_id UUID)
RETURNS SETOF projects
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM projects WHERE id = p_id;
$$;

-- Function to update a project (bypassing RLS)
CREATE OR REPLACE FUNCTION update_project_rpc(
  p_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_status TEXT,
  p_location TEXT,
  p_client TEXT,
  p_deadline TIMESTAMPTZ,
  p_image_url TEXT
)
RETURNS SETOF projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE projects
  SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    status = COALESCE(p_status, status),
    location = COALESCE(p_location, location),
    client = COALESCE(p_client, client),
    deadline = COALESCE(p_deadline, deadline),
    image_url = COALESCE(p_image_url, image_url),
    updated_at = NOW()
  WHERE id = p_id
  RETURNING *;
END;
$$;

-- Function to delete a project (bypassing RLS)
CREATE OR REPLACE FUNCTION delete_project_rpc(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM projects WHERE id = p_id;
$$;
