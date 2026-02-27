const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth } = require('../middleware/auth');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Only .jpg, .jpeg, .png, and .webp format allowed!'));
        }
    }
});

// Get all projects
// Owner: List all projects
// Admin: List all projects for the company
// Member: List only assigned projects
router.get('/list', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const userRole = req.user.role; // Role from JWT

        console.log(`[GET /list] User: ${userId}, Role: ${userRole}`);

        // 1. Owner (Super Admin) - View ALL projects grouped by company
        if (userRole === 'owner') {
            console.log('User is owner, fetching all projects grouped by company');
            
            // Fetch all companies
            const { data: companies, error: companiesError } = await supabase
                .from('companies')
                .select('*')
                .order('name');
            
            if (companiesError) throw companiesError;

            // Fetch all projects
            const { data: projects, error: projectsError } = await supabase
                .from('projects')
                .select('*')
                .order('created_at', { ascending: false });

            if (projectsError) throw projectsError;

            // Group projects by company
            const result = companies.map(company => {
                const companyProjects = projects.filter(p => p.company_id === company.id);
                return {
                    ...company,
                    projects: companyProjects
                };
            });

            // Add projects with no company (if any, though schema says company_id not null)
            const orphanProjects = projects.filter(p => !companies.find(c => c.id === p.company_id));
            if (orphanProjects.length > 0) {
                result.push({
                    id: 'orphan',
                    name: 'No Company',
                    projects: orphanProjects
                });
            }

            return res.json(result);
        }

        // 2. Fetch User Details to determine role and company
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            console.error('User not found in users table:', userError);
            return res.status(404).json({ message: 'User profile not found' });
        }

        console.log(`User details: Role=${user.role}, Company=${user.company_id}`);

        // 3. Admin Logic: Fetch all projects for their company
        if (user.role === 'admin') {
            if (!user.company_id) {
                return res.status(400).json({ message: 'Admin user is not assigned to a company' });
            }

            console.log(`Fetching projects for company ${user.company_id}`);
            const { data: projects, error } = await supabase
                .from('projects')
                .select('*, company:companies(id, name)')
                .eq('company_id', user.company_id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json(projects);
        }

        // 4. Member (User) Logic: Fetch only assigned projects
        // Default to this for any role other than 'owner' or 'admin'
        console.log('Fetching assigned projects for member');
        
        // Get project IDs from project_members
        const { data: memberships, error: memberError } = await supabase
            .from('project_members')
            .select('project_id')
            .eq('user_id', userId);

        if (memberError) throw memberError;

        if (!memberships || memberships.length === 0) {
            return res.json([]); // No projects assigned
        }

        const projectIds = memberships.map(m => m.project_id);
        
        // Fetch project details
        const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .select('*, company:companies(id, name)')
            .in('id', projectIds)
            .order('created_at', { ascending: false });

        if (projectsError) throw projectsError;
        
        return res.json(projects);

    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create new project (Admin only - in their own company)
router.post('/create', [auth, upload.single('image')], async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        // const userRole = req.user.role; // Not relying on global role for this, checking company role
        const { name, description, status, location, client, deadline, image } = req.body;

        console.log(`[POST /create] User: ${userId}`);

        // Get user's company membership
        let membership = null;

        // First try company_members
        const { data: memberData, error: memberError } = await supabase
            .from('company_members')
            .select('company_id, role')
            .eq('user_id', userId)
            .single();

        if (memberData) {
            membership = memberData;
        } else {
             // Fallback: Check users table
            const { data: userData } = await supabase
                .from('users')
                .select('company_id, role')
                .eq('id', userId)
                .single();
            
            if (userData && userData.company_id) {
                membership = {
                    company_id: userData.company_id,
                    role: userData.role
                };
            }
        }

        if (!membership) {
            return res.status(403).json({ message: 'Access denied. You must belong to a company.' });
        }

        if (membership.role !== 'admin' && membership.role !== 'owner') {
            return res.status(403).json({ message: 'Access denied. Only Admins/Owners can create projects.' });
        }
        
        const targetCompanyId = membership.company_id;

        // Handle image upload if present
        let imageUrl = image || null;
        if (req.file) {
            const fileName = `${targetCompanyId}/${Date.now()}_${path.basename(req.file.originalname)}`;
            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from('project-images')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype
                });

            if (uploadError) {
                console.error('Image upload error:', uploadError);
            } else {
                const { data: { publicUrl } } = supabase
                    .storage
                    .from('project-images')
                    .getPublicUrl(fileName);
                imageUrl = publicUrl;
            }
        }

        // Helper to normalize status
        const normalizeStatus = (s) => {
            if (!s) return 'upcoming';
            const statusMap = {
                'active': 'in_progress',
                'pending': 'upcoming',
                'done': 'completed'
            };
            const validStatuses = ['upcoming', 'in_progress', 'completed', 'on_hold'];
            const normalized = statusMap[s.toLowerCase()] || s.toLowerCase();
            return validStatuses.includes(normalized) ? normalized : 'upcoming';
        };

        const finalStatus = normalizeStatus(status);

        // Use direct insert (bypassing RPC as RLS is disabled)
        const { data: project, error } = await supabase
            .from('projects')
            .insert({
                company_id: targetCompanyId,
                name,
                description,
                status: finalStatus,
                location,
                client,
                deadline,
                image_url: imageUrl,
                created_by: userId
            })
            .select()
            .single();

        if (error) {
             console.error('Error creating project:', error);
             throw error;
        }

        res.status(201).json(project);
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create new project (Owner/Super Admin only - in any company)
router.post('/createOwner', [auth, upload.single('image')], async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const userRole = req.user.role;
        const { name, description, status, location, client, deadline, company_id, image } = req.body;

        console.log(`[POST /createOwner] User: ${userId}, Role: ${userRole}`);

        // 1. Owner (Super Admin) check
        if (userRole !== 'owner') {
             return res.status(403).json({ message: 'Access denied. Only System Owners can use this API.' });
        }

        if (!company_id) {
            return res.status(400).json({ message: 'Owner must provide company_id to create a project' });
        }
        
        const targetCompanyId = company_id;

        // Handle image upload if present
        let imageUrl = image || null;
        if (req.file) {
            const fileName = `${targetCompanyId}/${Date.now()}_${path.basename(req.file.originalname)}`;
            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from('project-images')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype
                });

            if (uploadError) {
                console.error('Image upload error:', uploadError);
            } else {
                const { data: { publicUrl } } = supabase
                    .storage
                    .from('project-images')
                    .getPublicUrl(fileName);
                imageUrl = publicUrl;
            }
        }

        // Helper to normalize status
        const normalizeStatus = (s) => {
            if (!s) return 'upcoming';
            const statusMap = {
                'active': 'in_progress',
                'pending': 'upcoming',
                'done': 'completed'
            };
            const validStatuses = ['upcoming', 'in_progress', 'completed', 'on_hold'];
            const normalized = statusMap[s.toLowerCase()] || s.toLowerCase();
            return validStatuses.includes(normalized) ? normalized : 'upcoming';
        };

        const finalStatus = normalizeStatus(status);

        // Use direct insert (bypassing RPC as RLS is disabled)
        const { data: project, error } = await supabase
            .from('projects')
            .insert({
                company_id: targetCompanyId,
                name,
                description,
                status: finalStatus,
                location,
                client,
                deadline,
                image_url: imageUrl,
                created_by: userId
            })
            .select()
            .single();

        if (error) {
             console.error('Error creating project:', error);
             throw error;
        }

        res.status(201).json(project);
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update project (Admin/Owner only)
router.put('/:id', [auth, upload.single('image')], async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const userRole = req.user.role;
        const projectId = req.params.id;
        const { name, description, status, location, client, deadline, image } = req.body;

        console.log(`[PUT /:id] User: ${userId}, Role: ${userRole}, Project: ${projectId}`);

        // 1. Fetch project details to check ownership (via RPC to bypass RLS)
        const { data: project, error: fetchError } = await supabase
            .rpc('get_project_by_id', { p_id: projectId })
            .single();

        if (fetchError || !project) {
            console.error('Project not found or RPC error:', fetchError);
            return res.status(404).json({ message: 'Project not found' });
        }

        // 2. Permission Check
        let isAuthorized = false;

        // Owner: Can update ANY project
        if (userRole === 'owner') {
            isAuthorized = true;
        } else {
            // Admin: Must belong to same company
            let membership = null;
            const { data: memberData, error: memberError } = await supabase
                .from('company_members')
                .select('company_id, role')
                .eq('user_id', userId)
                .single();

            if (memberData) {
                membership = memberData;
            } else {
                // Fallback
                const { data: userData } = await supabase
                    .from('users')
                    .select('company_id, role')
                    .eq('id', userId)
                    .single();
                if (userData && userData.company_id) {
                    membership = { company_id: userData.company_id, role: userData.role };
                }
            }

            if (membership && (membership.role === 'admin' || membership.role === 'owner')) {
                if (membership.company_id === project.company_id) {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Access denied. You do not have permission to update this project.' });
        }

        // 3. Prepare updates
        let imageUrl = image || project.image_url;
        
        // Handle new image upload
        if (req.file) {
            const fileName = `${project.company_id}/${Date.now()}_${path.basename(req.file.originalname)}`;
            const { error: uploadError } = await supabase
                .storage
                .from('project-images')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                });

            if (uploadError) {
                console.error('Image upload error:', uploadError);
            } else {
                const { data: { publicUrl } } = supabase
                    .storage
                    .from('project-images')
                    .getPublicUrl(fileName);
                imageUrl = publicUrl;
            }
        }

        // 4. Update directly (bypassing RLS)
        // Helper to normalize status
        const normalizeStatus = (s) => {
            if (!s) return 'upcoming';
            const statusMap = {
                'active': 'in_progress',
                'pending': 'upcoming',
                'done': 'completed'
            };
            const validStatuses = ['upcoming', 'in_progress', 'completed', 'on_hold'];
            const normalized = statusMap[s.toLowerCase()] || s.toLowerCase();
            return validStatuses.includes(normalized) ? normalized : 'upcoming';
        };

        const finalStatus = status ? normalizeStatus(status) : project.status;

        const { data: updatedProject, error: updateError } = await supabase
            .from('projects')
            .update({
                name: name || project.name,
                description: description || project.description,
                status: finalStatus,
                location: location || project.location,
                client: client || project.client,
                deadline: deadline || project.deadline,
                image_url: imageUrl
            })
            .eq('id', projectId)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating project:', updateError);
            throw updateError;
        }

        res.json(updatedProject);

    } catch (err) {
        console.error('Error updating project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete project (Admin/Owner only)
router.delete('/:id', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const userRole = req.user.role;
        const projectId = req.params.id;

        console.log(`[DELETE /:id] User: ${userId}, Role: ${userRole}, Project: ${projectId}`);

        // 1. Fetch project details to check ownership
        const { data: project, error: fetchError } = await supabase
            .rpc('get_project_by_id', { p_id: projectId })
            .single();

        if (fetchError || !project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // 2. Permission Check
        let isAuthorized = false;

        if (userRole === 'owner') {
            isAuthorized = true;
        } else {
            // Admin check
            let membership = null;
            const { data: memberData, error: memberError } = await supabase
                .from('company_members')
                .select('company_id, role')
                .eq('user_id', userId)
                .single();

            if (memberData) {
                membership = memberData;
            } else {
                // Fallback
                const { data: userData } = await supabase
                    .from('users')
                    .select('company_id, role')
                    .eq('id', userId)
                    .single();
                if (userData && userData.company_id) {
                    membership = { company_id: userData.company_id, role: userData.role };
                }
            }

            if (membership && (membership.role === 'admin' || membership.role === 'owner')) {
                if (membership.company_id === project.company_id) {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Access denied. You do not have permission to delete this project.' });
        }

        // 3. Delete directly (bypassing RLS)
        const { error: deleteError } = await supabase
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (deleteError) {
            console.error('Error deleting project:', deleteError);
            throw deleteError;
        }

        res.json({ message: 'Project deleted successfully' });

    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Assign members to project (Admin/Owner only)
router.post('/:id/members', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const projectId = req.params.id;
        const { userIds } = req.body; // Array of user IDs to add

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: 'userIds array is required' });
        }

        // Check permission
        let membership = null;
        const { data: memberData, error: memberError } = await supabase
            .from('company_members')
            .select('company_id, role')
            .eq('user_id', userId)
            .single();

        if (memberData) {
            membership = memberData;
        } else {
            // Fallback
            const { data: userData } = await supabase
                .from('users')
                .select('company_id, role')
                .eq('id', userId)
                .single();
            if (userData && userData.company_id) {
                membership = { company_id: userData.company_id, role: userData.role };
            }
        }

        if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Verify project belongs to user's company
        const { data: projectCheck, error: checkError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('company_id', membership.company_id)
            .single();

        if (checkError || !projectCheck) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // 4. Verify Users Exist (Optional - RLS might block this check)
        // We will rely on the database foreign key constraint to catch non-existent users.
        // If we try to filter by company_members and RLS prevents seeing them, we block valid operations.
        // So we skip the explicit pre-check and handle the insert error.

        // 4. Resolve User IDs (Smart Check)
        // The frontend might be sending `company_members.id` instead of `users.id`.
        // We need to resolve all incoming IDs to actual `users.id`.
        
        let finalUserIds = [];
        const invalidIds = [];

        // Step A: Check if IDs exist directly in `users` table
        const { data: directUsers, error: userError } = await supabase
            .from('users')
            .select('id')
            .in('id', userIds);

        if (userError) console.error('Error checking users:', userError);

        const foundUserIds = directUsers ? directUsers.map(u => u.id) : [];
        finalUserIds = [...foundUserIds];

        // Step B: Identify IDs that were NOT found in `users` table
        const remainingIds = userIds.filter(id => !foundUserIds.includes(id));

        if (remainingIds.length > 0) {
            console.log(`[POST /members] ${remainingIds.length} IDs not found in 'users', checking 'company_members'...`);
            
            // Step C: Check if these remaining IDs are actually `company_members.id`
            const { data: memberRecords, error: memberError } = await supabase
                .from('company_members')
                .select('id, user_id')
                .in('id', remainingIds);

            if (memberError) console.error('Error checking company_members:', memberError);

            if (memberRecords && memberRecords.length > 0) {
                const resolvedUserIds = memberRecords.map(m => m.user_id);
                console.log(`[POST /members] Resolved ${resolvedUserIds.length} IDs from 'company_members' table.`);
                finalUserIds = [...finalUserIds, ...resolvedUserIds];
            }
        }

        // Remove duplicates just in case
        finalUserIds = [...new Set(finalUserIds)];

        if (finalUserIds.length === 0) {
             return res.status(400).json({ message: 'No valid user IDs found. Please provide valid User IDs or Company Member IDs.' });
        }

        console.log(`[POST /members] Final list of User IDs to insert:`, finalUserIds);

        const inserts = finalUserIds.map(uid => ({
            project_id: projectId,
            user_id: uid,
            role: 'member'
        }));

        const { data, error } = await supabase
            .from('project_members')
            .upsert(inserts, { onConflict: 'project_id, user_id' })
            .select();

        if (error) {
             console.error('Error adding project members:', error);
             // Handle specific FK error (Postgres code 23503)
             if (error.code === '23503') {
                 // Even with force insert, if the DB says no, it's a hard no.
                 return res.status(400).json({ message: 'Database rejected: One or more users do not exist.' });
             }
             // Handle RLS policy violation
             if (error.code === '42501') {
                 return res.status(403).json({ message: 'Permission denied to add members (RLS).' });
             }
             throw error;
        }

        console.log(`[POST /members] Successfully added members:`, data);
        res.json(data);
    } catch (err) {
        console.error('Error adding project members:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get project members
router.get('/:id/members', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const userRole = req.user.role;
        const projectId = req.params.id;

        // 1. Fetch project to get company_id
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('company_id')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // 2. Check Permissions
        let isAuthorized = false;

        // a) Owner
        if (userRole === 'owner') {
            isAuthorized = true;
        } 
        // b) Admin of the company
        else {
             // Check company membership
             const { data: membership } = await supabase
                .from('company_members')
                .select('role, company_id')
                .eq('user_id', userId)
                .single();
            
            if (membership && (membership.role === 'admin' || membership.role === 'owner') && membership.company_id === project.company_id) {
                isAuthorized = true;
            } else {
                // Fallback check in users table
                const { data: userData } = await supabase
                    .from('users')
                    .select('company_id, role')
                    .eq('id', userId)
                    .single();
                
                if (userData && userData.company_id === project.company_id && userData.role === 'admin') {
                    isAuthorized = true;
                }
            }
        }

        // c) Member of the project
        if (!isAuthorized) {
            const { data: isMember } = await supabase
                .from('project_members')
                .select('id')
                .eq('project_id', projectId)
                .eq('user_id', userId)
                .maybeSingle();
            
            if (isMember) {
                isAuthorized = true;
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // 3. Fetch Members
        // Fix: Use simple join syntax or separate queries if foreign key detection fails
        const { data: members, error } = await supabase
            .from('project_members')
            .select(`
                user_id,
                role,
                joined_at
            `)
            .eq('project_id', projectId);

        if (error) {
            console.error('Error fetching project members basic info:', error);
            throw error;
        }

        // Manually fetch user details to avoid PGRST200 error
        if (members && members.length > 0) {
            const userIds = members.map(m => m.user_id);
            const { data: users, error: usersError } = await supabase
                .from('users')
                .select('id, name, email, avatar, role')
                .in('id', userIds);
            
            if (!usersError && users) {
                // Merge user data into members
                const userMap = {};
                users.forEach(u => userMap[u.id] = u);
                
                members.forEach(m => {
                    m.user = userMap[m.user_id] || null;
                });
            }
        }
        
        res.json(members);
    } catch (err) {
        console.error('Error fetching project members:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Remove member from project (Admin/Owner only)
router.delete('/:id/members/:memberId', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const projectId = req.params.id;
        const memberIdToRemove = req.params.memberId;

        // Check permission
        const { data: membership, error: memberError } = await supabase
            .from('company_members')
            .select('company_id, role')
            .eq('user_id', userId)
            .single();

        if (memberError || !membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Verify project belongs to user's company
        const { data: projectCheck, error: checkError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('company_id', membership.company_id)
            .single();

        if (checkError || !projectCheck) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const { error } = await supabase
            .from('project_members')
            .delete()
            .eq('project_id', projectId)
            .eq('user_id', memberIdToRemove);

        if (error) throw error;

        res.json(data);
    } catch (err) {
        console.error('Error removing project member:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get assignable members for a project
// Returns list of all company members categorized by assignment status
router.get('/:id/assignable-members', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const projectId = req.params.id;

        // 1. Get Project to find Company ID
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('company_id, name')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const companyId = project.company_id;

        // 2. Verify Requestor Permission (Must be Admin/Owner or Project Member?)
        // Usually only Admins/Owners assign members.
        // Let's check if user is in the company at least.
        const { data: requestorMember, error: requestorError } = await supabase
            .from('company_members')
            .select('role')
            .eq('company_id', companyId)
            .eq('user_id', userId)
            .single();

        if (requestorError || !requestorMember) {
             // Maybe they are owner?
             const { data: ownerCheck } = await supabase
                 .from('users')
                 .select('role')
                 .eq('id', userId)
                 .single();
             
             if (ownerCheck?.role !== 'owner') {
                 return res.status(403).json({ message: 'Access denied. You are not a member of this company.' });
             }
        }

        // 3. Fetch ALL Company Members
        const { data: companyMembers, error: membersError } = await supabase
            .from('company_members')
            .select('user_id, role, joined_at')
            .eq('company_id', companyId);

        if (membersError) throw membersError;

        const memberUserIds = companyMembers.map(m => m.user_id);

        // 4. Fetch User Details for these members
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('id, name, email, avatar, role')
            .in('id', memberUserIds);

        if (usersError) throw usersError;

        // 5. Fetch ALL Project Memberships for these users in this company's projects
        // We need to know which projects they are in.
        // First get all projects of the company to filter properly
        const { data: companyProjects } = await supabase
            .from('projects')
            .select('id, name')
            .eq('company_id', companyId);
        
        const companyProjectIds = companyProjects.map(p => p.id);

        const { data: projectMemberships, error: projMemError } = await supabase
            .from('project_members')
            .select('project_id, user_id')
            .in('project_id', companyProjectIds)
            .in('user_id', memberUserIds);

        if (projMemError) throw projMemError;

        // 6. Construct Response
        const projectMap = {};
        companyProjects.forEach(p => projectMap[p.id] = p.name);

        const result = users.map(user => {
            const memberInfo = companyMembers.find(m => m.user_id === user.id);
            
            // Find all projects this user is assigned to
            const userProjectIds = projectMemberships
                .filter(pm => pm.user_id === user.id)
                .map(pm => pm.project_id);

            const assignedToCurrent = userProjectIds.includes(projectId);
            
            const otherProjects = userProjectIds
                .filter(pid => pid !== projectId)
                .map(pid => ({
                    id: pid,
                    name: projectMap[pid] || 'Unknown Project'
                }));

            // Determine Status Category
            let status = 'available';
            if (assignedToCurrent) {
                status = 'assigned_current';
            } else if (otherProjects.length > 0) {
                status = 'assigned_other';
            }

            return {
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    avatar: user.avatar,
                    role: memberInfo ? memberInfo.role : user.role // Use company role if available
                },
                status: status,
                assigned_to_current: assignedToCurrent,
                other_assignments: otherProjects
            };
        });

        res.json({
            project_id: projectId,
            project_name: project.name,
            members: result
        });

    } catch (err) {
        console.error('Error fetching assignable members:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get staff allocation status for a project (Admin/Owner)
router.get('/:id/staff-allocation', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const projectId = req.params.id;

        // 1. Get Project & Company Info
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, company_id, name')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const companyId = project.company_id;

        // 2. Permission Check (Admin/Owner only)
        let isAuthorized = false;
        if (req.user.role === 'owner') {
            isAuthorized = true;
        } else {
            // Check if user is admin of this company
            const { data: membership } = await supabase
                .from('company_members')
                .select('role, company_id')
                .eq('user_id', userId)
                .single();
            
            if (membership && (membership.role === 'admin' || membership.role === 'owner') && membership.company_id === companyId) {
                isAuthorized = true;
            } else {
                 // Fallback: Check users table
                const { data: userData } = await supabase
                    .from('users')
                    .select('company_id, role')
                    .eq('id', userId)
                    .single();
                
                if (userData && userData.company_id === companyId && userData.role === 'admin') {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Access denied. Only Admins/Owners can view staff allocation.' });
        }

        // 3. Fetch all company members (potential staff)
        // We need user details for all members of the company
        const { data: companyMembers, error: membersError } = await supabase
            .from('company_members')
            .select(`
                user_id,
                role,
                user:user_id (id, name, email, avatar, role)
            `)
            .eq('company_id', companyId);

        if (membersError) throw membersError;

        // Also fetch users who might be in users table but not company_members (edge case)
        // For simplicity, we'll stick to company_members as the source of truth for "Staff"
        
        // 4. Fetch all project memberships for this company's projects
        // We need to know which projects these users are assigned to
        const { data: allProjectMemberships, error: projMemError } = await supabase
            .from('project_members')
            .select('project_id, user_id, role, projects!inner(company_id)')
            .eq('projects.company_id', companyId);

        if (projMemError) throw projMemError;

        // 5. Categorize Users
        const assignedToThisProject = [];
        const assignedToOtherProjects = [];
        const availableStaff = [];

        // Map to store user's project assignments
        const userProjectMap = {}; // userId -> [projectId1, projectId2]
        allProjectMemberships.forEach(pm => {
            if (!userProjectMap[pm.user_id]) {
                userProjectMap[pm.user_id] = [];
            }
            userProjectMap[pm.user_id].push(pm.project_id);
        });

        companyMembers.forEach(member => {
            const uid = member.user_id;
            const user = member.user; // User details
            
            if (!user) return; // Skip if user details are missing

            const projects = userProjectMap[uid] || [];

            if (projects.includes(projectId)) {
                assignedToThisProject.push(user);
            } else if (projects.length > 0) {
                assignedToOtherProjects.push(user);
            } else {
                availableStaff.push(user);
            }
        });

        res.json({
            assigned: assignedToThisProject,
            available: availableStaff,
            otherProjects: assignedToOtherProjects
        });

    } catch (err) {
        console.error('Error fetching staff allocation:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;