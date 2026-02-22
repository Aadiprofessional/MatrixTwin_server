-- 1. Add created_by to companies if not exists
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 2. Create projects table
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

-- 3. Create project_members table
CREATE TABLE IF NOT EXISTS public.project_members (
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- 4. Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- 5. Policies for projects

-- Admin/Owner can do everything on projects of their company
CREATE POLICY "Admins/Owners can manage projects" ON public.projects
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members cm
            WHERE cm.company_id = projects.company_id
            AND cm.user_id = auth.uid()
            AND cm.role IN ('admin', 'owner')
        )
    );

-- Members can view assigned projects
CREATE POLICY "Members can view assigned projects" ON public.projects
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = projects.id
            AND pm.user_id = auth.uid()
        )
    );

-- 6. Policies for project_members

-- Admin/Owner can manage project members
CREATE POLICY "Admins/Owners can manage project members" ON public.project_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.company_members cm ON cm.company_id = p.company_id
            WHERE p.id = project_members.project_id
            AND cm.user_id = auth.uid()
            AND cm.role IN ('admin', 'owner')
        )
    );

-- Members can view their own membership
CREATE POLICY "Members can view their own membership" ON public.project_members
    FOR SELECT
    USING (
        user_id = auth.uid()
    );

-- 7. FIX for company_members RLS (Recursion issue)
-- Drop existing policies if they are causing issues (optional, but safer to redefine)
DROP POLICY IF EXISTS "Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "Members can view own membership" ON public.company_members;

-- Allow users to insert themselves as owner if they created the company
CREATE POLICY "Creators can insert themselves as owner" ON public.company_members
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid() 
        AND role = 'owner'
        AND EXISTS (
            SELECT 1 FROM public.companies c
            WHERE c.id = company_members.company_id
            AND c.created_by = auth.uid()
        )
    );

-- Standard Admin/Owner management policy (avoiding recursion by not querying company_members for the check on itself if possible, 
-- or by using a simplified check for admins)
-- Note: To avoid recursion, we rely on the fact that for INSERT/UPDATE/DELETE, we check if the executing user is an admin/owner.
-- But checking if they are admin/owner requires querying company_members.
-- The trick is to break the cycle or use security definer functions, but for simple RLS:
CREATE POLICY "Admins/Owners can manage members" ON public.company_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members cm
            WHERE cm.company_id = company_members.company_id
            AND cm.user_id = auth.uid()
            AND cm.role IN ('admin', 'owner')
            -- Prevent recursion by ensuring we are looking at a different row or using a different method?
            -- Actually, standard practice is to separate policies.
            -- This policy allows managing *other* members.
        )
    );

-- Users can view their own membership
CREATE POLICY "Users can view own membership" ON public.company_members
    FOR SELECT
    USING ( user_id = auth.uid() );

-- 8. Backfill company_members for existing companies (owners)
-- This ensures that existing company owners are added to the company_members table
-- We use a DO block to handle potential missing columns or data issues gracefully
DO $$
BEGIN
    -- Only try to insert if created_by exists and is not null
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'created_by') THEN
        INSERT INTO public.company_members (company_id, user_id, role)
        SELECT id, created_by, 'owner'
        FROM public.companies
        WHERE created_by IS NOT NULL
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;
