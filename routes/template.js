const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend('re_CYa5oG13_ECrEJT5L42u1VydajXWK6W8s');

// Middleware to temporarily disable RLS for template operations
const disableRLS = async (req, res, next) => {
  try {
    // Create a new supabase client with service role key for bypassing RLS
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || 'https://ahtardktcamfwgjuwmeb.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodGFyZGt0Y2FtZndnanV3bWViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE4NzI5NCwiZXhwIjoyMDQ3NzYzMjk0fQ.YCJJhJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJG';
    
    req.supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    next();
  } catch (error) {
    console.error('Error setting up admin client:', error);
    next();
  }
};

/**
 * @route   POST /api/template/create
 * @desc    Create a new template entry with workflow
 * @access  Private/Admin
 */
router.post('/create', auth, disableRLS, async (req, res) => {
  try {
    const { 
      formData, 
      processNodes, 
      selectedCcs, 
      createdBy,
      projectId
    } = req.body;

    const supabase = req.supabaseAdmin || req.supabase;

    // Validate admin role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', createdBy)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create template entries' });
    }

    // Create template entry
    const templateEntry = {
      id: `template_${Date.now()}`,
      date: formData.creationDate || new Date().toISOString().split('T')[0],
      project: formData.project || 'Unknown Project',
      project_id: projectId,
      creator: user.name,
      template_name: formData.templateName || 'Untitled Template',
      template_type: formData.templateType || 'General',
      description: formData.description || '',
      template_data: formData.templateData || {},
      is_active: formData.isActive !== undefined ? formData.isActive : true,
      notes: formData.additionalNotes || '',
      form_data: formData,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      status: 'pending',
      current_node_index: 0
    };

    // Insert template entry
    const { data: insertedTemplate, error: templateError } = await supabase
      .from('template_entries')
      .insert([templateEntry])
      .select()
      .single();

    if (templateError) throw templateError;

    // Create workflow nodes
    const workflowNodes = processNodes.map((node, index) => ({
      template_id: insertedTemplate.id,
      node_id: node.id,
      node_type: node.type,
      node_name: node.name,
      executor_id: null,
      executor_name: node.executor || null,
      node_order: index,
      status: index === 0 ? 'pending' : 'waiting',
      settings: node.settings || {},
      created_at: new Date().toISOString()
    }));

    const { error: nodesError } = await supabase
      .from('template_workflow_nodes')
      .insert(workflowNodes);

    if (nodesError) throw nodesError;

    // Create CC assignments
    if (selectedCcs && selectedCcs.length > 0) {
      const ccAssignments = selectedCcs.map(cc => ({
        template_id: insertedTemplate.id,
        user_id: cc.id,
        user_name: cc.name,
        user_email: cc.email,
        role: 'cc',
        created_at: new Date().toISOString()
      }));

      const { error: ccError } = await supabase
        .from('template_assignments')
        .insert(ccAssignments);

      if (ccError) throw ccError;
    }

    // Send initial notifications
    await sendWorkflowNotifications(insertedTemplate.id, 'created', supabase);

    res.status(201).json({
      success: true,
      template: insertedTemplate,
      message: 'Template entry created successfully'
    });

  } catch (error) {
    console.error('Error creating template entry:', error);
    res.status(500).json({ 
      error: 'Failed to create template entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/template/list/:userId
 * @desc    Get template entries for a user based on their role and active project
 * @access  Private
 */
router.get('/list/:userId', auth, disableRLS, async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectId } = req.query;

    const supabase = req.supabaseAdmin || req.supabase;

    // Get user role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let templateQuery = supabase
      .from('template_entries')
      .select(`
        *,
        template_workflow_nodes(*),
        template_assignments(*)
      `);

    // Filter by project if projectId is provided
    if (projectId) {
      templateQuery = templateQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      // Admin can see all entries
      console.log('Admin user - showing all template entries');
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('template_assignments')
        .select('template_id')
        .eq('user_id', userId);

      if (assignError) {
        console.error('Error fetching assignments:', assignError);
      }

      const assignedTemplateIds = assignments?.map(a => a.template_id) || [];
      console.log(`User ${userId} is assigned to template entries:`, assignedTemplateIds);

      if (assignedTemplateIds.length > 0) {
        templateQuery = templateQuery.in('id', assignedTemplateIds);
      } else {
        // User has no assignments, return empty array
        return res.json([]);
      }
    }

    const { data: templateEntries, error: fetchError } = await templateQuery
      .order('created_at', { ascending: false });

    if (fetchError) throw fetchError;

    res.json(templateEntries || []);

  } catch (error) {
    console.error('Error fetching template entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch template entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/template/:templateId
 * @desc    Get a specific template entry with full details
 * @access  Private
 */
router.get('/:templateId', auth, disableRLS, async (req, res) => {
  try {
    const { templateId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: templateEntry, error } = await supabase
      .from('template_entries')
      .select(`
        *,
        template_workflow_nodes(*),
        template_assignments(*),
        template_comments(*)
      `)
      .eq('id', templateId)
      .single();

    if (error) throw error;

    if (!templateEntry) {
      return res.status(404).json({ error: 'Template entry not found' });
    }

    res.json(templateEntry);

  } catch (error) {
    console.error('Error fetching template entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch template entry',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/template/:templateId
 * @desc    Update a template entry
 * @access  Private
 */
router.put('/:templateId', auth, disableRLS, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { formData, userId } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    // Update template entry
    const { data: updatedTemplate, error } = await supabase
      .from('template_entries')
      .update({
        form_data: formData,
        template_name: formData.templateName || 'Untitled Template',
        template_type: formData.templateType || 'General',
        description: formData.description || '',
        template_data: formData.templateData || {},
        is_active: formData.isActive !== undefined ? formData.isActive : true,
        updated_at: new Date().toISOString()
      })
      .eq('id', templateId)
      .select()
      .single();

    if (error) throw error;

    // Send update notifications
    await sendWorkflowNotifications(templateId, 'updated', supabase);

    res.json({
      success: true,
      template: updatedTemplate,
      message: 'Template entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating template entry:', error);
    res.status(500).json({ 
      error: 'Failed to update template entry',
      details: error.message 
    });
  }
});

/**
 * @route   POST /api/template/:templateId/workflow
 * @desc    Handle workflow actions (approve/reject)
 * @access  Private
 */
router.post('/:templateId/workflow', auth, disableRLS, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { action, comment, userId } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    // Get user info
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get current template entry
    const { data: templateEntry, error: templateError } = await supabase
      .from('template_entries')
      .select('*, template_workflow_nodes(*)')
      .eq('id', templateId)
      .single();

    if (templateError || !templateEntry) {
      return res.status(404).json({ error: 'Template entry not found' });
    }

    // Add comment
    if (comment) {
      const { error: commentError } = await supabase
        .from('template_comments')
        .insert([{
          template_id: templateId,
          user_id: userId,
          user_name: user.name,
          comment: comment,
          action: action,
          created_at: new Date().toISOString()
        }]);

      if (commentError) throw commentError;
    }

    // Update workflow status
    const currentNodeIndex = templateEntry.current_node_index;
    const workflowNodes = templateEntry.template_workflow_nodes.sort((a, b) => a.node_order - b.node_order);
    
    if (action === 'approve') {
      // Mark current node as completed
      if (workflowNodes[currentNodeIndex]) {
        const { error: nodeError } = await supabase
          .from('template_workflow_nodes')
          .update({
            status: 'completed',
            completed_by: user.name,
            completed_at: new Date().toISOString()
          })
          .eq('id', workflowNodes[currentNodeIndex].id);

        if (nodeError) throw nodeError;
      }

      // Move to next node or complete
      const nextNodeIndex = currentNodeIndex + 1;
      if (nextNodeIndex < workflowNodes.length) {
        // Move to next node
        const { error: updateError } = await supabase
          .from('template_entries')
          .update({
            current_node_index: nextNodeIndex,
            updated_at: new Date().toISOString()
          })
          .eq('id', templateId);

        if (updateError) throw updateError;

        // Mark next node as pending
        const { error: nextNodeError } = await supabase
          .from('template_workflow_nodes')
          .update({ status: 'pending' })
          .eq('id', workflowNodes[nextNodeIndex].id);

        if (nextNodeError) throw nextNodeError;
      } else {
        // Complete the template entry
        const { error: completeError } = await supabase
          .from('template_entries')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', templateId);

        if (completeError) throw completeError;
      }
    } else if (action === 'reject') {
      // Mark template entry as rejected
      const { error: rejectError } = await supabase
        .from('template_entries')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('id', templateId);

      if (rejectError) throw rejectError;
    }

    // Send notifications
    await sendWorkflowNotifications(templateId, action, supabase, comment);

    res.json({
      success: true,
      message: `Template entry ${action}d successfully`
    });

  } catch (error) {
    console.error('Error processing workflow action:', error);
    res.status(500).json({ 
      error: 'Failed to process workflow action',
      details: error.message 
    });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(templateId, action, supabase, comment = '') {
  try {
    // Get template entry with assignments
    const { data: templateEntry, error } = await supabase
      .from('template_entries')
      .select(`
        *,
        template_assignments(*),
        template_workflow_nodes(*)
      `)
      .eq('id', templateId)
      .single();

    if (error || !templateEntry) {
      console.error('Error fetching template entry for notifications:', error);
      return;
    }

    // Get all users to notify (CCs and current workflow executor)
    const usersToNotify = [];
    
    // Add CC users
    templateEntry.template_assignments.forEach(assignment => {
      if (assignment.role === 'cc') {
        usersToNotify.push({
          email: assignment.user_email,
          name: assignment.user_name
        });
      }
    });

    // Add current workflow executor
    const currentNode = templateEntry.template_workflow_nodes
      .sort((a, b) => a.node_order - b.node_order)[templateEntry.current_node_index];
    
    if (currentNode && currentNode.executor_name) {
      // Find executor email from users table
      const { data: executor } = await supabase
        .from('users')
        .select('email')
        .eq('name', currentNode.executor_name)
        .single();
      
      if (executor) {
        usersToNotify.push({
          email: executor.email,
          name: currentNode.executor_name
        });
      }
    }

    // Send emails
    for (const user of usersToNotify) {
      await sendTemplateEmail(user, templateEntry, action, comment);
    }

  } catch (error) {
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send template email notification
 */
async function sendTemplateEmail(user, templateEntry, action, comment = '') {
  try {
    const subject = `Template ${action.charAt(0).toUpperCase() + action.slice(1)} - ${templateEntry.template_name}`;
    
    let actionText = '';
    switch (action) {
      case 'created':
        actionText = 'A new template has been created';
        break;
      case 'updated':
        actionText = 'A template has been updated';
        break;
      case 'approve':
        actionText = 'A template has been approved';
        break;
      case 'reject':
        actionText = 'A template has been rejected';
        break;
      default:
        actionText = `A template has been ${action}`;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Template Notification</h2>
        
        <p>Dear ${user.name},</p>
        
        <p>${actionText} and requires your attention.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #374151;">Template Details</h3>
          <p><strong>Entry ID:</strong> ${templateEntry.id}</p>
          <p><strong>Template Name:</strong> ${templateEntry.template_name}</p>
          <p><strong>Template Type:</strong> ${templateEntry.template_type}</p>
          <p><strong>Project:</strong> ${templateEntry.project}</p>
          <p><strong>Creator:</strong> ${templateEntry.creator}</p>
          <p><strong>Date:</strong> ${templateEntry.date}</p>
          <p><strong>Description:</strong> ${templateEntry.description}</p>
          <p><strong>Active:</strong> ${templateEntry.is_active ? 'Yes' : 'No'}</p>
          <p><strong>Status:</strong> ${templateEntry.status}</p>
        </div>
        
        ${comment ? `
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #92400e;">Comment:</h4>
            <p style="margin-bottom: 0;">${comment}</p>
          </div>
        ` : ''}
        
        <p>Please log in to the system to review the template and take any necessary actions.</p>
        
        <p>Best regards,<br>BuildSphere Template Management System</p>
      </div>
    `;

    await resend.emails.send({
      from: 'BuildSphere <noreply@buildsphere.com>',
      to: [user.email],
      subject: subject,
      html: html
    });

    console.log(`Template notification email sent to ${user.email}`);

  } catch (error) {
    console.error('Error sending template email:', error);
  }
}

module.exports = router; 