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
            console.log('User is owner, fetching all projects');
            const { data: projects, error } = await supabase
                .from('projects')
                .select('*, members:project_members(user_id, role)')
                .order('created_at', { ascending: false });

            if (error) throw error;
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
            // Note: 'owner' in company_members might just be Company Owner, treated as Admin here
            // unless they are also Global Owner (handled above).
            console.log('User is admin/company-owner, fetching company projects');
            const { data: projects, error } = await supabase
                .from('projects')
                .select('*, members:project_members(user_id, role)')
                .eq('company_id', membership.company_id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json(projects);
        }

        // 4. Member - View only assigned projects
        if (membership.role === 'member') {
            console.log('User is member, fetching assigned projects');
            // Use !inner join to filter projects where user is a member
            const { data: projects, error } = await supabase
                .from('projects')
                .select('*, members:project_members!inner(user_id, role)')
                .eq('company_id', membership.company_id)
                .eq('members.user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
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
        // const userRole = req.user.role; // Not relying on global role for this, checking company role
        const { name, description, status, location, client, deadline } = req.body;

        console.log(`[POST /create] User: ${userId}`);

        // Get user's company membership
        const { data: membership, error: memberError } = await supabase
            .from('company_members')
            .select('company_id, role')
            .eq('user_id', userId)
            .single();

        if (memberError || !membership) {
            return res.status(403).json({ message: 'Access denied. You must belong to a company.' });
        }

        if (membership.role !== 'admin' && membership.role !== 'owner') {
            return res.status(403).json({ message: 'Access denied. Only Admins/Owners can create projects.' });
        }
        
        const targetCompanyId = membership.company_id;

        // Handle image upload if present
        let imageUrl = null;
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

        const { data: project, error } = await supabase
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

        if (error) throw error;

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
        const { name, description, status, location, client, deadline, company_id } = req.body;

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
        let imageUrl = null;
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

        const { data: project, error } = await supabase
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

        if (error) throw error;

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
        const projectId = req.params.id;
        const { name, description, status, location, client, deadline } = req.body;

        // Check permission via RLS or explicit check
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
            return res.status(404).json({ message: 'Project not found or access denied' });
        }

        const updates = {
            name,
            description,
            status,
            location,
            client,
            deadline,
            updated_at: new Date()
        };

        // Handle image update
        if (req.file) {
            const fileName = `${membership.company_id}/${Date.now()}_${path.basename(req.file.originalname)}`;
            const { error: uploadError } = await supabase
                .storage
                .from('project-images')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                });

            if (!uploadError) {
                const { data: { publicUrl } } = supabase
                    .storage
                    .from('project-images')
                    .getPublicUrl(fileName);
                updates.image_url = publicUrl;
            }
        }

        // Filter out undefined values
        Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

        const { data: updatedProject, error } = await supabase
            .from('projects')
            .update(updates)
            .eq('id', projectId)
            .select()
            .single();

        if (error) throw error;

        res.json(updatedProject);
    } catch (err) {
        console.error('Error updating project:', err);
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