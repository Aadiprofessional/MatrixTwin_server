-- MASTER FIX SCRIPT (RECURSION PROOF)
-- Run this entire script in Supabase SQL Editor to fix all issues

-- 0. Ensure tables exist
CREATE TABLE IF NOT EXISTS public.company_members (
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (company_id, user_id)
);

ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'completed', 'on_hold')),
    location TEXT,
    client TEXT,
    deadline TIMESTAMPTZ,
    image_url TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.project_members (
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- 1. Enable RLS
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- 2. Create Helper Function with RECURSION PREVENTION
CREATE OR REPLACE FUNCTION public.get_company_role(user_uuid UUID, company_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_creator BOOLEAN;
    member_role TEXT;
BEGIN
    -- 1. Check if user is the Creator (Owner) via companies table
    -- This avoids querying company_members, preventing recursion for Owners
    SELECT EXISTS (
        SELECT 1 FROM public.companies 
        WHERE id = company_uuid AND created_by = user_uuid
    ) INTO is_creator;

    IF is_creator THEN
        RETURN 'owner';
    END IF;

    -- 2. If not creator, check company_members
    -- Note: This might still recurse for non-owners if not handled carefully,
    -- but for the Company Creation flow (Owner), this path is skipped.
    SELECT role INTO member_role
    FROM public.company_members 
    WHERE user_id = user_uuid 
    AND company_id = company_uuid;

    RETURN member_role;
END;
$$;

-- 3. Drop recursive policies
DROP POLICY IF EXISTS "Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "Admins/Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "Members can view own membership" ON public.company_members;
DROP POLICY IF EXISTS "Users can view own membership" ON public.company_members;
DROP POLICY IF EXISTS "Creators can insert themselves as owner" ON public.company_members;
DROP POLICY IF EXISTS "Admins/Owners can view all members" ON public.company_members;
DROP POLICY IF EXISTS "Admins/Owners can manage projects" ON public.projects;
DROP POLICY IF EXISTS "Members can view assigned projects" ON public.projects;
DROP POLICY IF EXISTS "Admins/Owners can manage project members" ON public.project_members;
DROP POLICY IF EXISTS "Members can view their own membership" ON public.project_members;

-- 4. Define ROBUST Policies

-- COMPANY MEMBERS Policies

-- A. View Own Membership (Safe)
CREATE POLICY "Users can view own membership" ON public.company_members
    FOR SELECT USING ( user_id = auth.uid() );

-- B. Manage Members (Admins/Owners)
-- Uses get_company_role which short-circuits for Owners
CREATE POLICY "Admins/Owners can manage members" ON public.company_members
    FOR ALL USING (
        public.get_company_role(auth.uid(), company_id) IN ('admin', 'owner')
    );

-- C. Insert Self as Owner (Redundant but explicit for safety)
CREATE POLICY "Creators can insert themselves as owner" ON public.company_members
    FOR INSERT WITH CHECK (
        user_id = auth.uid() 
        AND role = 'owner'
        AND EXISTS (
            SELECT 1 FROM public.companies c
            WHERE c.id = company_members.company_id
            AND c.created_by = auth.uid()
        )
    );

-- PROJECTS Policies
CREATE POLICY "Admins/Owners can manage projects" ON public.projects
    FOR ALL USING (
        public.get_company_role(auth.uid(), company_id) IN ('admin', 'owner')
    );

CREATE POLICY "Members can view assigned projects" ON public.projects
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = projects.id
            AND pm.user_id = auth.uid()
        )
    );

-- PROJECT MEMBERS Policies
CREATE POLICY "Admins/Owners can manage project members" ON public.project_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_members.project_id
            AND public.get_company_role(auth.uid(), p.company_id) IN ('admin', 'owner')
        )
    );

CREATE POLICY "Members can view their own membership" ON public.project_members
    FOR SELECT USING (
        user_id = auth.uid()
    );

-- 5. Backfill Helper
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'created_by') THEN
        INSERT INTO public.company_members (company_id, user_id, role)
        SELECT id, created_by, 'owner'
        FROM public.companies
        WHERE created_by IS NOT NULL
        ON CONFLICT (company_id, user_id) DO NOTHING;
    END IF;
END $$;
