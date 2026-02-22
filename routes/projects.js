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

        // 1. Owner (Super Admin) - View ALL projects
        if (userRole === 'owner') {
            console.log('User is owner, fetching all projects via RPC');
            // Use RPC to bypass RLS recursion
            const { data: projects, error } = await supabase
                .rpc('get_all_projects_owner');

            if (error) {
                console.error('RPC get_all_projects_owner failed:', error);
                // Fallback to normal query if RPC doesn't exist (though RLS might fail)
                const { data: projectsFallback, error: errorFallback } = await supabase
                    .from('projects')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                if (errorFallback) throw errorFallback;
                return res.json(projectsFallback);
            }
            return res.json(projects);
        }

        // 2. Get user's company membership for Admin/Member
        const { data: membership, error: memberError } = await supabase
            .from('company_members')
            .select('company_id, role')
            .eq('user_id', userId)
            .single();

        if (memberError || !membership) {
            console.log('User has no company membership');
            return res.status(404).json({ message: 'User does not belong to any company' });
        }
        
        console.log(`User company membership: ${JSON.stringify(membership)}`);

        // 3. Admin - View all company projects
        if (membership.role === 'admin' || membership.role === 'owner') {
            console.log('User is admin/company-owner, fetching company projects via RPC');
            
            // Try RPC first
            const { data: projects, error } = await supabase
                .rpc('get_company_projects', { p_company_id: membership.company_id });

            if (error) {
                console.error('RPC get_company_projects failed, falling back to RLS:', error);
                const { data: projectsFallback, error: errorFallback } = await supabase
                    .from('projects')
                    .select('*, members:project_members(user_id, role)')
                    .eq('company_id', membership.company_id)
                    .order('created_at', { ascending: false });

                if (errorFallback) throw errorFallback;
                return res.json(projectsFallback);
            }
            return res.json(projects);
        }

        // 4. Member - View only assigned projects
        if (membership.role === 'member') {
            console.log('User is member, fetching assigned projects via RPC');
            
            // Try RPC first
            const { data: projects, error } = await supabase
                .rpc('get_member_projects', { 
                    p_user_id: userId, 
                    p_company_id: membership.company_id 
                });

            if (error) {
                console.error('RPC get_member_projects failed, falling back to RLS:', error);
                const { data: projectsFallback, error: errorFallback } = await supabase
                    .from('projects')
                    .select('*, members:project_members!inner(user_id, role)')
                    .eq('company_id', membership.company_id)
                    .eq('members.user_id', userId)
                    .order('created_at', { ascending: false });

                if (errorFallback) throw errorFallback;
                return res.json(projectsFallback);
            }
            return res.json(projects);
        }

        // Default: Access denied if role not recognized
        return res.status(403).json({ message: 'Access denied' });

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
        const userRole = req.user.role; // Get global role
        const { name, description, status, location, client, deadline, image } = req.body;

        console.log(`[POST /create] User: ${userId}, Role: ${userRole}`);

        let targetCompanyId = null;

        // Special handling for System Owner
        if (userRole === 'owner') {
             // If user is owner, they might not be in company_members table but have a company via users.company_id
             // OR they are creating for their own company.
             
             // First check if they have a company_id in users table
             const { data: userData, error: userError } = await supabase
                .from('users')
                .select('company_id')
                .eq('id', userId)
                .single();
            
             if (!userError && userData && userData.company_id) {
                 targetCompanyId = userData.company_id;
                 console.log(`Owner found with company_id: ${targetCompanyId}`);
             } else {
                 // Fallback: Check company_members just in case
                 const { data: membership, error: memberError } = await supabase
                    .from('company_members')
                    .select('company_id, role')
                    .eq('user_id', userId)
                    .single();
                 
                 if (!memberError && membership) {
                     targetCompanyId = membership.company_id;
                 }
             }

             if (!targetCompanyId) {
                 // If still no company, owner cannot create a "regular" project without a company context
                 // Use /createOwner endpoint to create for ANY company
                 return res.status(400).json({ message: 'Owner does not have a linked company. Please use /createOwner endpoint or join a company.' });
             }

        } else {
            // Regular Admin check
            // Get user's company membership
            let membership = null;

            // 1. Try fetching from company_members
            const { data: memberData, error: memberError } = await supabase
                .from('company_members')
                .select('company_id, role')
                .eq('user_id', userId)
                .single();
            
            if (!memberError && memberData) {
                membership = memberData;
            } else {
                // 2. Fallback: Check users table for company_id (especially for new admins)
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('company_id, role')
                    .eq('id', userId)
                    .single();

                if (!userError && userData && userData.company_id) {
                    // If user has company_id in users table, treat them as a member of that company
                    // Their role in the company is assumed to be their user role (e.g. 'admin')
                    membership = {
                        company_id: userData.company_id,
                        role: userData.role // 'admin' or 'user'
                    };
                }
            }

            if (!membership) {
                return res.status(403).json({ message: 'Access denied. You must belong to a company.' });
            }

            if (membership.role !== 'admin' && membership.role !== 'owner') {
                return res.status(403).json({ message: 'Access denied. Only Admins/Owners can create projects.' });
            }
            
            targetCompanyId = membership.company_id;
        }

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

        // Use RPC to create project (bypassing RLS)
        const { data: project, error } = await supabase
            .rpc('create_project_rpc', {
                p_company_id: targetCompanyId,
                p_name: name,
                p_description: description,
                p_status: status || 'upcoming',
                p_location: location,
                p_client: client,
                p_deadline: deadline,
                p_image_url: imageUrl,
                p_created_by: userId
            })
            .single();

        if (error) {
             console.error('RPC create_project_rpc failed:', error);
             // Fallback to normal insert if RPC fails (though likely RLS will block it)
             const { data: projectFallback, error: errorFallback } = await supabase
                .from('projects')
                .insert({
                    company_id: targetCompanyId,
                    name,
                    description,
                    status: status || 'upcoming',
                    location,
                    client,
                    deadline,
                    image_url: imageUrl,
                    created_by: userId
                })
                .select()
                .single();

             if (errorFallback) throw errorFallback;
             return res.status(201).json(projectFallback);
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

        // Use RPC to create project (bypassing RLS)
        const { data: project, error } = await supabase
            .rpc('create_project_rpc', {
                p_company_id: targetCompanyId,
                p_name: name,
                p_description: description,
                p_status: status || 'upcoming',
                p_location: location,
                p_client: client,
                p_deadline: deadline,
                p_image_url: imageUrl,
                p_created_by: userId
            })
            .single();

        if (error) {
             console.error('RPC create_project_rpc failed:', error);
             // Fallback to normal insert if RPC fails
             const { data: projectFallback, error: errorFallback } = await supabase
                .from('projects')
                .insert({
                    company_id: targetCompanyId,
                    name,
                    description,
                    status: status || 'upcoming',
                    location,
                    client,
                    deadline,
                    image_url: imageUrl,
                    created_by: userId
                })
                .select()
                .single();

             if (errorFallback) throw errorFallback;
             return res.status(201).json(projectFallback);
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
            const { data: membership, error: memberError } = await supabase
                .from('company_members')
                .select('company_id, role')
                .eq('user_id', userId)
                .single();

            if (!memberError && membership && (membership.role === 'admin' || membership.role === 'owner')) {
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

        // 4. Update via RPC (bypassing RLS)
        // Pass existing values if new ones are undefined/null
        const { data: updatedProject, error: updateError } = await supabase
            .rpc('update_project_rpc', {
                p_id: projectId,
                p_name: name || project.name,
                p_description: description || project.description,
                p_status: status || project.status,
                p_location: location || project.location,
                p_client: client || project.client,
                p_deadline: deadline || project.deadline,
                p_image_url: imageUrl
            })
            .single();

        if (updateError) {
            console.error('RPC update_project_rpc failed:', updateError);
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
            const { data: membership, error: memberError } = await supabase
                .from('company_members')
                .select('company_id, role')
                .eq('user_id', userId)
                .single();

            if (!memberError && membership && (membership.role === 'admin' || membership.role === 'owner')) {
                if (membership.company_id === project.company_id) {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Access denied. You do not have permission to delete this project.' });
        }

        // 3. Delete via RPC
        const { error: deleteError } = await supabase
            .rpc('delete_project_rpc', { p_id: projectId });

        if (deleteError) {
            console.error('RPC delete_project_rpc failed:', deleteError);
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

        // Prepare inserts
        const inserts = userIds.map(uid => ({
            project_id: projectId,
            user_id: uid,
            role: 'member'
        }));

        const { data, error } = await supabase
            .from('project_members')
            .upsert(inserts, { onConflict: 'project_id, user_id' })
            .select();

        if (error) throw error;

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
        const projectId = req.params.id;

        // RLS will handle visibility
        const { data, error } = await supabase
            .from('project_members')
            .select(`
                user_id,
                role,
                joined_at,
                user:user_id (id, name, email, avatar)
            `)
            .eq('project_id', projectId);

        if (error) throw error;

        res.json(data);
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

        res.json({ message: 'Member removed' });
    } catch (err) {
        console.error('Error removing project member:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;