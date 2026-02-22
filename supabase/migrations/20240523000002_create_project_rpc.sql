-- Function to create a project (bypassing RLS)
CREATE OR REPLACE FUNCTION create_project_rpc(
  p_company_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_status TEXT,
  p_location TEXT,
  p_client TEXT,
  p_deadline TEXT,
  p_image_url TEXT,
  p_created_by UUID
)
RETURNS SETOF projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deadline TIMESTAMPTZ;
BEGIN
  -- Handle empty deadline safely
  IF p_deadline IS NULL OR p_deadline = '' THEN
    v_deadline := NULL;
  ELSE
    v_deadline := p_deadline::TIMESTAMPTZ;
  END IF;

  RETURN QUERY
  INSERT INTO projects (
    company_id,
    name,
    description,
    status,
    location,
    client,
    deadline,
    image_url,
    created_by
  ) VALUES (
    p_company_id,
    p_name,
    p_description,
    p_status,
    p_location,
    p_client,
    v_deadline,
    p_image_url,
    p_created_by
  )
  RETURNING *;
END;
$$;
