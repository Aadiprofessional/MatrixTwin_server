-- 1. Promote admin user to owner
UPDATE public.users 
SET role = 'owner' 
WHERE email = 'admin@matrixaiglobal.com';

-- 2. Confirm emails for both users (ensures they can login)
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email IN ('admin@matrixaiglobal.com', 'user@matrixaiglobal.com');

-- 3. Fix infinite recursion in RLS policies
-- The previous policy caused infinite recursion because it queried the same table (users) inside the policy check.
-- We can fix this by using `auth.jwt()` metadata if the role is stored there, OR by using a SECURITY DEFINER function.
-- Since we are relying on the `public.users` table for roles, we need to be careful.

-- OPTION A: If we trust the metadata (which we should sync), we can use:
-- (auth.jwt() ->> 'role')::text = 'owner' -- But our role is in custom claims or public table.

-- OPTION B (Better for now): Create a secure function to check owner role without recursion.
CREATE OR REPLACE FUNCTION is_owner()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() AND role = 'owner'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Now use this function in the policy
DROP POLICY IF EXISTS "Owners can view all profiles" ON public.users;

CREATE POLICY "Owners can view all profiles" 
  ON public.users 
  FOR SELECT 
  USING ( is_owner() );


-- 4. Ensure admin_requests and companies policies are correct (idempotent check)
-- (These should already be there from previous scripts, but good to double check if you want)
