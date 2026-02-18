const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

// Middleware to check user role and permissions
const checkUserRole = async (req, res, next) => {
    try {
        const creator_uid = req.body.creator_uid || req.query.creator_uid;
        if (!creator_uid) {
            return res.status(400).json({ error: 'Creator UID is required' });
        }

        console.log('CheckUserRole: Looking up user with ID:', creator_uid);
        console.log('CheckUserRole: Supabase client available:', !!req.supabase);
        console.log('CheckUserRole: Environment variables:', {
            SUPABASE_URL: process.env.SUPABASE_URL,
            SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT_SET'
        });

        // First try to list all users to see if the table is accessible
        console.log('CheckUserRole: Testing table access...');
        const { data: allUsers, error: accessError } = await req.supabase
            .from('users')
            .select('id, email, role')
            .limit(5);

        console.log('CheckUserRole: Table access test result:', { 
            allUsers: allUsers ? allUsers.length : 'null', 
            accessError: accessError 
        });

        // Use maybeSingle() instead of single() to handle cases where user might not exist
        const { data: userData, error: userError } = await req.supabase
            .from('users')
            .select('role')
            .eq('id', creator_uid)
            .maybeSingle();

        console.log('CheckUserRole: User lookup result:', { userData, userError });

        if (userError) {
            console.error('User lookup error:', userError);
            return res.status(500).json({ error: 'Database error: ' + userError.message });
        }

        if (!userData) {
            console.log('CheckUserRole: No user found for ID:', creator_uid);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('CheckUserRole: User found:', userData);
        req.creator_uid = creator_uid;
        req.userRole = userData.role;
        next();
    } catch (error) {
        console.error('CheckUserRole middleware error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Create new project (Admin only)
router.post('/', upload.single('image'), checkUserRole, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admins can create projects' });
        }

        const { name, location, client, deadline, description } = req.body;
        
        // Create project first
        let project;
        try {
            const { data, error } = await req.supabase
                .from('projects')
                .insert({
                    name,
                    location,
                    client,
                    deadline,
                    description,
                    created_by: req.creator_uid,
                    status: 'upcoming'
                })
                .select()
                .single();

            if (error) throw error;
            project = data;
        } catch (error) {
            console.error('Project creation error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Handle image upload if present
        if (req.file) {
            try {
                const fileExt = path.extname(req.file.originalname);
                const fileName = `projects/${project.id}/image${fileExt}`;
                
                const { error: uploadError } = await req.supabase.storage
                    .from('user-avatars')
                    .upload(fileName, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: true
                    });

                if (uploadError) throw uploadError;
                
                const { data: { publicUrl } } = req.supabase.storage
                    .from('user-avatars')
                    .getPublicUrl(fileName);
                    
                // Update project with image URL
                const { error: updateError } = await req.supabase
                    .from('projects')
                    .update({ image_url: publicUrl })
                    .eq('id', project.id);

                if (updateError) throw updateError;
                project.image_url = publicUrl;
            } catch (error) {
                console.error('Image upload error:', error);
                // Don't fail the whole request if image upload fails
                // Just return the project without image
            }
        }

        res.status(201).json(project);
    } catch (error) {
        console.error('Project creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update project status
router.patch('/:id/status', checkUserRole, async (req, res) => {
    try {
        const { status } = req.body;
        const projectId = req.params.id;

        // Validate status
        const validStatuses = ['upcoming', 'in_progress', 'completed', 'on_hold', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }

        // Check if user has permission to update this project
        let hasPermission = false;
        if (req.userRole === 'admin') {
            hasPermission = true;
        } else {
            const { data: assignment, error: assignmentError } = await req.supabase
                .from('project_assignments')
                .select('*')
                .eq('project_id', projectId)
                .eq('user_id', req.creator_uid)
                .maybeSingle();

            if (!assignmentError && assignment) {
                hasPermission = true;
            }
        }

        if (!hasPermission) {
            return res.status(403).json({ error: 'You do not have permission to update this project' });
        }

        // Update project status
        const { error: updateError } = await req.supabase
            .from('projects')
            .update({ status })
            .eq('id', projectId);

        if (updateError) throw updateError;

        res.status(200).json({ message: 'Project status updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Alternative PUT route for project status update (in case PATCH doesn't work in serverless)
router.put('/:id/status', checkUserRole, async (req, res) => {
    try {
        const { status } = req.body;
        const projectId = req.params.id;

        // Validate status
        const validStatuses = ['upcoming', 'in_progress', 'completed', 'on_hold', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }

        // Check if user has permission to update this project
        let hasPermission = false;
        if (req.userRole === 'admin') {
            hasPermission = true;
        } else {
            const { data: assignment, error: assignmentError } = await req.supabase
                .from('project_assignments')
                .select('*')
                .eq('project_id', projectId)
                .eq('user_id', req.creator_uid)
                .maybeSingle();

            if (!assignmentError && assignment) {
                hasPermission = true;
            }
        }

        if (!hasPermission) {
            return res.status(403).json({ error: 'You do not have permission to update this project' });
        }

        // Update project status
        const { error: updateError } = await req.supabase
            .from('projects')
            .update({ status })
            .eq('id', projectId);

        if (updateError) throw updateError;

        res.status(200).json({ message: 'Project status updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assign user to project
router.post('/assign', checkUserRole, async (req, res) => {
    try {
        const { project_id, user_id } = req.body;

        // Verify the assignee exists
        const { data: assignee, error: assigneeError } = await req.supabase
            .from('users')
            .select('role')
            .eq('id', user_id)
            .maybeSingle();

        if (assigneeError || !assignee) {
            return res.status(404).json({ error: 'Assignee not found' });
        }

        // Check permissions based on roles
        if (req.userRole === 'admin') {
            // Admin can assign anyone
        } else if (['projectManager', 'contractor'].includes(req.userRole)) {
            // Project managers and contractors can only assign workers
            if (assignee.role !== 'worker') {
                return res.status(403).json({ error: 'You can only assign workers' });
            }

            // Verify they have access to this project
            const { data: hasAccess, error: accessError } = await req.supabase
                .from('project_assignments')
                .select('*')
                .eq('project_id', project_id)
                .eq('user_id', req.creator_uid)
                .maybeSingle();

            if (accessError || !hasAccess) {
                return res.status(403).json({ error: 'You do not have access to this project' });
            }
        } else {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        // Check if assignment already exists
        const { data: existingAssignment, error: checkError } = await req.supabase
            .from('project_assignments')
            .select('*')
            .eq('project_id', project_id)
            .eq('user_id', user_id)
            .maybeSingle();

        if (existingAssignment) {
            return res.status(200).json({ message: 'User is already assigned to this project' });
        }

        // Create the assignment
        const { error: assignError } = await req.supabase
            .from('project_assignments')
            .insert({
                project_id,
                user_id,
                assigned_by: req.creator_uid
            });

        if (assignError) throw assignError;

        res.status(200).json({ message: 'User assigned to project successfully' });
    } catch (error) {
        console.error('Assignment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get assigned projects
router.get('/assigned', checkUserRole, async (req, res) => {
    try {
        let projects;

        if (req.userRole === 'admin') {
            // Admin gets all projects
            const { data, error } = await req.supabase
                .from('projects')
                .select('*');
            
            if (error) throw error;
            projects = data;
        } else {
            // Others get their assigned projects
            const { data, error } = await req.supabase
                .from('project_assignments')
                .select(`
                    project_id,
                    projects (*)
                `)
                .eq('user_id', req.creator_uid);

            if (error) throw error;
            projects = data.map(a => a.projects);
        }

        res.status(200).json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all workers
router.get('/workers', checkUserRole, async (req, res) => {
    try {
        if (!['admin', 'projectManager', 'contractor'].includes(req.userRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const { data: workers, error } = await req.supabase
            .from('users')
            .select(`
                id,
                email,
                role,
                assigned_projects
            `)
            .eq('role', 'worker');

        if (error) throw error;
        res.status(200).json(workers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project (Admin only)
router.delete('/:id', checkUserRole, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admins can delete projects' });
        }

        const { error } = await req.supabase
            .from('projects')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.status(200).json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 