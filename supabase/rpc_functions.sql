-- Function to approve a company join request
CREATE OR REPLACE FUNCTION public.approve_company_join_request_rpc(
    p_request_id UUID,
    p_approver_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_company_id UUID;
    v_request_status TEXT;
BEGIN
    -- 1. Get request details
    SELECT user_id, company_id, status
    INTO v_user_id, v_company_id, v_request_status
    FROM public.company_join_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;

    IF v_request_status != 'pending' THEN
        RAISE EXCEPTION 'Request is not pending';
    END IF;

    -- 2. Update request status
    UPDATE public.company_join_requests
    SET status = 'approved',
        updated_at = NOW()
    WHERE id = p_request_id;

    -- 3. Add user to company_members
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, 'member')
    ON CONFLICT (company_id, user_id) DO NOTHING;

    -- 4. Update user's company_id in users table
    UPDATE public.users
    SET company_id = v_company_id,
        updated_at = NOW()
    WHERE id = v_user_id;

END;
$$;

-- Function to remove a member from a company
CREATE OR REPLACE FUNCTION public.remove_company_member_rpc(
    p_user_id UUID,
    p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 1. Delete from company_members
    DELETE FROM public.company_members
    WHERE user_id = p_user_id AND company_id = p_company_id;

    -- 2. Nullify company_id in users table if it matches
    UPDATE public.users
    SET company_id = NULL
    WHERE id = p_user_id AND company_id = p_company_id;
    
    -- 3. Optionally remove from project_members for projects in this company?
    -- For now, we leave project history or handle it separately.
    -- If we want to clean up project access immediately:
    DELETE FROM public.project_members pm
    USING public.projects p
    WHERE pm.project_id = p.id
      AND p.company_id = p_company_id
      AND pm.user_id = p_user_id;

END;
$$;
