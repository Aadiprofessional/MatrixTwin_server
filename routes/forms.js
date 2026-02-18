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
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'));
        }
    }
});

// Middleware to check user role
const checkUserRole = async (req, res, next) => {
    try {
        const creator_uid = req.body.uid || req.query.uid;
        if (!creator_uid) {
            return res.status(400).json({ error: 'Creator UID is required' });
        }

        const { data: userData, error: userError } = await req.supabase
            .from('users')
            .select('role')
            .eq('id', creator_uid)
            .single();

        if (userError) {
            return res.status(500).json({ error: userError.message });
        }

        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        req.creator_uid = creator_uid;
        req.userRole = userData.role;
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Create new form
router.post('/createform', upload.single('pdf'), checkUserRole, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admins can create forms' });
        }

        const { name, description, assign, project_id, priority, type_of_form } = req.body;
        
        // More robust array parsing
        let assignArray;
        try {
            assignArray = typeof assign === 'string' ? JSON.parse(assign) : assign;
            if (!Array.isArray(assignArray)) {
                return res.status(400).json({ error: 'assign must be an array of user IDs' });
            }
        } catch (error) {
            return res.status(400).json({ error: 'Invalid assign array format' });
        }

        // Validate required fields
        if (!name || !project_id || !priority || !type_of_form) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'PDF file is required' });
        }

        // Generate unique form ID
        const formId = uuidv4();

        // Upload PDF to Supabase Storage
        const fileName = `projects/${project_id}/forms/${type_of_form}/${formId}.pdf`;
        const { error: uploadError } = await req.supabase.storage
            .from('user-avatars')
            .upload(fileName, req.file.buffer, {
                contentType: 'application/pdf',
                upsert: false
            });

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: { publicUrl } } = req.supabase.storage
            .from('user-avatars')
            .getPublicUrl(fileName);

        // Create form record
        const { data: form, error: formError } = await req.supabase
            .from('forms')
            .insert({
                id: formId,
                project_id,
                created_by: req.creator_uid,
                name,
                description,
                form_type: type_of_form,
                priority,
                file_url: publicUrl,
                status: 'pending'
            })
            .select()
            .single();

        if (formError) throw formError;

        // Create form assignments
        const assignments = assignArray.map(userId => ({
            form_id: formId,
            user_id: userId
        }));

        const { error: assignError } = await req.supabase
            .from('form_assignments')
            .insert(assignments);

        if (assignError) throw assignError;

        res.status(201).json(form);
    } catch (error) {
        console.error('Form creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get forms
router.get('/getforms', checkUserRole, async (req, res) => {
    try {
        const { project_id, form_type } = req.query;

        // Basic validation
        if (!project_id) {
            return res.status(400).json({ error: 'Project ID is required' });
        }

        // If admin, get all forms
        if (req.userRole === 'admin') {
            let query = req.supabase
                .from('forms')
                .select('*')
                .eq('project_id', project_id);

            if (form_type) {
                query = query.eq('form_type', form_type);
            }

            const { data: forms, error } = await query;
            if (error) throw error;
            return res.json(forms);
        }

        // For non-admin users, get only assigned forms
        const { data: assignedForms, error } = await req.supabase
            .from('forms')
            .select('*')
            .eq('project_id', project_id)
            .in(
                'id',
                req.supabase
                    .from('form_assignments')
                    .select('form_id')
                    .eq('user_id', req.creator_uid)
            );

        if (error) throw error;

        // Filter by form_type if provided
        let forms = assignedForms;
        if (form_type) {
            forms = forms.filter(form => form.form_type === form_type);
        }

        res.json(forms);
    } catch (error) {
        console.error('Error fetching forms:', error);
        res.status(500).json({ error: error.message });
    }
});

// Respond to form
router.post('/respond/:formId', upload.single('pdf'), checkUserRole, async (req, res) => {
    try {
        const { formId } = req.params;
        const { project_id } = req.body;

        // Check if user is assigned to this form
        const { data: assignment, error: assignError } = await req.supabase
            .from('form_assignments')
            .select('*')
            .eq('form_id', formId)
            .eq('user_id', req.creator_uid)
            .single();

        if (assignError || !assignment) {
            return res.status(403).json({ error: 'You are not assigned to this form' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Response PDF is required' });
        }

        // Upload response PDF
        const fileName = `projects/${project_id}/forms/responses/${formId}_response.pdf`;
        const { error: uploadError } = await req.supabase.storage
            .from('user-avatars')
            .upload(fileName, req.file.buffer, {
                contentType: 'application/pdf',
                upsert: true
            });

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: { publicUrl } } = req.supabase.storage
            .from('user-avatars')
            .getPublicUrl(fileName);

        // Update form status and response URL
        const { error: updateError } = await req.supabase
            .from('forms')
            .update({ 
                status: 'answered',
                response_url: publicUrl,
                updated_at: new Date().toISOString()
            })
            .eq('id', formId);

        if (updateError) throw updateError;

        res.json({ message: 'Form response submitted successfully' });
    } catch (error) {
        console.error('Error submitting form response:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update form status
router.patch('/status/:formId', checkUserRole, async (req, res) => {
    try {
        const { formId } = req.params;
        const { status } = req.body;

        if (!['pending', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be either pending or closed' });
        }

        // Only admin can update status
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admins can update form status' });
        }

        const { error: updateError } = await req.supabase
            .from('forms')
            .update({ 
                status,
                updated_at: new Date().toISOString()
            })
            .eq('id', formId);

        if (updateError) throw updateError;

        res.json({ message: 'Form status updated successfully' });
    } catch (error) {
        console.error('Error updating form status:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 