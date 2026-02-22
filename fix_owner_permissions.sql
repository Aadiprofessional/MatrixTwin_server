-- Allow Owners to view all user profiles
-- This is required for Owners to find users to promote/demote and to list admins
CREATE POLICY "Owners can view all profiles" 
  ON public.users 
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );
