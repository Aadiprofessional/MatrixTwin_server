const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

// Polyfill for Headers if not available (Node.js < 18)
if (typeof Headers === 'undefined') {
  global.Headers = class Headers {
    constructor(init) {
      this.headers = new Map();
      if (init) {
        if (typeof init === 'object') {
          for (const [key, value] of Object.entries(init)) {
            this.headers.set(key.toLowerCase(), value);
          }
        }
      }
    }
    
    set(name, value) {
      this.headers.set(name.toLowerCase(), value);
    }
    
    get(name) {
      return this.headers.get(name.toLowerCase());
    }
    
    has(name) {
      return this.headers.has(name.toLowerCase());
    }
    
    delete(name) {
      return this.headers.delete(name.toLowerCase());
    }
    
    forEach(callback) {
      this.headers.forEach(callback);
    }
    
    *[Symbol.iterator]() {
      for (const [key, value] of this.headers) {
        yield [key, value];
      }
    }
  };
}

const { createFormAssignmentNotifications } = require('./notifications');

// Middleware to temporarily disable RLS for form operations
const disableRLS = async (req, res, next) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      throw new Error('Missing Supabase URL');
    }

    const keyToUse = serviceKey || anonKey;
    
    if (!keyToUse) {
      throw new Error('Missing Supabase key (Service Role or Anon)');
    }

    if (!serviceKey) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not found. Using Anon key. RLS bypass may not work.');
    }
    
    req.supabaseAdmin = createClient(supabaseUrl, keyToUse, {
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
 * @route   POST /api/custom-forms/templates/create
 * @desc    Create a new form template (admin only)
 * @access  Private/Admin
 */
router.post('/templates/create', auth, disableRLS, async (req, res) => {
  try {
    const { 
      name,
      description,
      formStructure,
      processNodes,
      projectId
    } = req.body;

    console.log('=== FORM TEMPLATE CREATION START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID from auth:', req.user.id);

    const supabase = req.supabaseAdmin || req.supabase;

    // Skip user validation in development mode
    let user = null;
    if (req.user.id === 'dev-user-id') {
      user = { role: 'admin', name: 'Dev User', email: 'dev@test.com' };
    } else {
      // Validate admin role
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role, name, email')
        .eq('id', req.user.id)
        .single();

      if (userError || !userData) {
        console.error('User validation failed:', userError);
        return res.status(404).json({ error: 'User not found' });
      }

      if (userData.role !== 'admin') {
        console.error('Non-admin user attempted to create form template:', userData);
        return res.status(403).json({ error: 'Only admins can create form templates' });
      }
      
      user = userData;
    }

    // Create form template with workflow
    const templateData = {
      name,
      description: description || '',
      form_structure: {
        pages: formStructure,
        workflow: processNodes
      },
      project_id: projectId,
      created_by: req.user.id === 'dev-user-id' ? '5fcf581f-f854-459b-b521-aae507891337' : req.user.id
    };

    console.log('Template data to insert:', templateData);

    const { data: insertedTemplate, error: templateError } = await supabase
      .from('form_templates')
      .insert([templateData])
      .select()
      .single();

    if (templateError) {
      console.error('Failed to insert form template:', templateError);
      throw templateError;
    }

    console.log('Form template created successfully:', insertedTemplate);

    res.status(201).json({
      success: true,
      template: insertedTemplate,
      message: 'Form template created successfully'
    });

  } catch (error) {
    console.error('=== FORM TEMPLATE CREATION ERROR ===');
    console.error('Error creating form template:', error);
    res.status(500).json({ 
      error: 'Failed to create form template',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/custom-forms/templates
 * @desc    Get all form templates
 * @access  Private
 */
router.get('/templates', auth, disableRLS, async (req, res) => {
  try {
    const { projectId } = req.query;
    const supabase = req.supabaseAdmin || req.supabase;

    let query = supabase
      .from('form_templates')
      .select('*')
      .eq('is_active', true);

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data: templates, error } = await query
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(templates || []);

  } catch (error) {
    console.error('Error fetching form templates:', error);
    res.status(500).json({ 
      error: 'Failed to fetch form templates',
      details: error.message 
    });
  }
});

/**
 * @route   POST /api/custom-forms/entries/create
 * @desc    Create a new form entry with workflow
 * @access  Private
 */
router.post('/entries/create', auth, disableRLS, async (req, res) => {
  try {
    const { 
      templateId,
      formData,
      projectId,
      formId,
      name
    } = req.body;

    console.log('=== FORM ENTRY CREATION START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID from auth:', req.user.id);

    const supabase = req.supabaseAdmin || req.supabase;

    // Get form template
    const { data: template, error: templateError } = await supabase
      .from('form_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return res.status(404).json({ error: 'Form template not found' });
    }

    // Skip user validation in development mode
    let user = null;
    if (req.user.id === 'dev-user-id') {
      user = { role: 'admin', name: 'Dev User', email: 'dev@test.com' };
    } else {
      // Get user info
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role, name, email')
        .eq('id', req.user.id)
        .single();

      if (userError || !userData) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      user = userData;
    }

    console.log('Creator user:', user);
    console.log('Template:', template);

    const processNodes = template.form_structure.workflow || [];

    // Create form entry
    const formEntry = {
      ...(formId ? { id: formId } : {}), // Use formId if provided
      template_id: templateId,
      template_name: template.name,
      project_id: projectId,
      project_name: projectId || formData.projectId || formData.projectName || 'Unknown Project',
      form_data: {
        ...formData,
        name: name || formData.name || formData.formNumber // Ensure name is saved
      },
      created_by: req.user.id === 'dev-user-id' ? '5fcf581f-f854-459b-b521-aae507891337' : req.user.id,
      status: 'pending',
      current_node_index: 1,
      current_active_node: processNodes.find(n => n.type === 'node')?.id || null
    };

    console.log('Form entry to insert:', formEntry);

    const { data: insertedEntry, error: entryError } = await supabase
      .from('form_entries')
      .insert([formEntry])
      .select()
      .single();

    if (entryError) {
      console.error('Failed to insert form entry:', entryError);
      throw entryError;
    }

    console.log('Form entry inserted successfully:', insertedEntry);

    // Create workflow nodes
    const workflowNodes = [];
    for (let index = 0; index < processNodes.length; index++) {
      const node = processNodes[index];
      let executorId = null;
      let executorName = null;

      console.log(`Processing node ${index}:`, node);

      if (node.executorId) {
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('id', node.executorId)
          .single();
        
        if (!executorError && executor) {
          executorId = executor.id;
          executorName = executor.name;
        }
      } else if (node.executorName || node.executor) {
        const executorNameToSearch = node.executorName || node.executor;
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('name', executorNameToSearch)
          .single();
        
        if (!executorError && executor) {
          executorId = executor.id;
          executorName = executor.name;
        }
      }

      const workflowNode = {
        form_entry_id: insertedEntry.id,
        node_id: node.id,
        node_type: node.type,
        node_name: node.name,
        executor_id: executorId,
        executor_name: executorName,
        node_order: index,
        status: index === 1 ? 'pending' : 'waiting',
        edit_access: node.editAccess !== false,
        settings: node.settings || {},
        expire_time: (node.expireTime && node.expireTime !== 'unlimited') ? node.expireTime : null,
        expire_duration: node.expireDuration || null
      };

      workflowNodes.push(workflowNode);
    }

    const { error: nodesError } = await supabase
      .from('form_workflow_nodes')
      .insert(workflowNodes);

    if (nodesError) {
      console.error('Failed to insert workflow nodes:', nodesError);
      throw nodesError;
    }

    // Create CC assignments
    const allAssignments = [];
    for (let index = 0; index < processNodes.length; index++) {
      const node = processNodes[index];
      if (node.ccRecipients && node.ccRecipients.length > 0) {
        for (const cc of node.ccRecipients) {
          const assignment = {
            form_entry_id: insertedEntry.id,
            user_id: cc.id,
            user_name: cc.name,
            user_email: cc.email,
            role: 'cc',
            node_id: node.id,
            node_order: index
          };
          allAssignments.push(assignment);
        }
      }
    }

    if (allAssignments.length > 0) {
      const { error: ccError } = await supabase
        .from('form_assignments')
        .insert(allAssignments);

      if (ccError) {
        console.error('Failed to insert CC assignments:', ccError);
        throw ccError;
      }
    }

    // Send initial notifications
    await sendWorkflowNotifications(insertedEntry.id, 'created', supabase);

    console.log('=== FORM ENTRY CREATION SUCCESS ===');

    res.status(201).json({
      success: true,
      entry: insertedEntry,
      message: 'Form entry created successfully'
    });

  } catch (error) {
    console.error('=== FORM ENTRY CREATION ERROR ===');
    console.error('Error creating form entry:', error);
    res.status(500).json({ 
      error: 'Failed to create form entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/custom-forms/entries/:userId
 * @desc    Get form entries for a user
 * @access  Private
 */
router.get('/entries/:userId', auth, disableRLS, async (req, res) => {
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

    let entryQuery = supabase
      .from('form_entries')
      .select(`
        *,
        form_workflow_nodes(*),
        form_assignments(*)
      `);

    if (projectId) {
      entryQuery = entryQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      // Admin can see all entries
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments } = await supabase
        .from('form_assignments')
        .select('form_entry_id')
        .eq('user_id', userId);

      const assignedEntryIds = assignments?.map(a => a.form_entry_id) || [];

      // Get entries where user is executor
      const { data: executorNodes } = await supabase
        .from('form_workflow_nodes')
        .select('form_entry_id')
        .eq('executor_id', userId);

      const executorEntryIds = executorNodes?.map(n => n.form_entry_id) || [];

      const conditions = [`created_by.eq.${userId}`];
      
      if (assignedEntryIds.length > 0) {
        conditions.push(`id.in.(${assignedEntryIds.join(',')})`);
      }
      
      if (executorEntryIds.length > 0) {
        conditions.push(`id.in.(${executorEntryIds.join(',')})`);
      }

      if (conditions.length > 1) {
        entryQuery = entryQuery.or(conditions.join(','));
      } else {
        entryQuery = entryQuery.eq('created_by', userId);
      }
    }

    const { data: entries, error: entryError } = await entryQuery
      .order('created_at', { ascending: false });

    if (entryError) throw entryError;

    res.json(entries || []);

  } catch (error) {
    console.error('Error fetching form entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch form entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/custom-forms/entries/details/:entryId
 * @desc    Get specific form entry with workflow details
 * @access  Private
 */
router.get('/entries/details/:entryId', auth, disableRLS, async (req, res) => {
  try {
    const { entryId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: entry, error: entryError } = await supabase
      .from('form_entries')
      .select(`
        *,
        form_workflow_nodes(*),
        form_assignments(*),
        form_comments(*)
      `)
      .eq('id', entryId)
      .single();

    if (entryError) throw entryError;

    if (!entry) {
      return res.status(404).json({ error: 'Form entry not found' });
    }

    res.json(entry);

  } catch (error) {
    console.error('Error fetching form entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch form entry',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/custom-forms/entries/:entryId/update
 * @desc    Update form entry and advance workflow
 * @access  Private
 */
router.put('/entries/:entryId/update', auth, disableRLS, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { 
      formData, 
      action,
      comment
    } = req.body;

    const userId = req.user.id; // Get from authenticated user
    const supabase = req.supabaseAdmin || req.supabase;

    // Get current form entry
    const { data: entry, error: entryError } = await supabase
      .from('form_entries')
      .select(`
        *,
        form_workflow_nodes(*),
        form_assignments(*)
      `)
      .eq('id', entryId)
      .single();

    if (entryError || !entry) {
      return res.status(404).json({ error: 'Form entry not found' });
    }

    // Get user info
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check permissions
    const currentNode = entry.form_workflow_nodes
      .find(node => node.node_order === entry.current_node_index);

    const canUpdate = user.role === 'admin' || 
                     entry.created_by === userId ||
                     entry.form_assignments.some(a => a.user_id === userId) ||
                     (currentNode && currentNode.executor_id === userId);

    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to update this form entry' });
    }

    // Update form data if provided
    if (formData) {
      const { error: updateError } = await supabase
        .from('form_entries')
        .update({
          form_data: formData,
          updated_at: new Date().toISOString()
        })
        .eq('id', entryId);

      if (updateError) throw updateError;
    }

    // Add comment if provided
    if (comment) {
      const { error: commentError } = await supabase
        .from('form_comments')
        .insert([{
          form_entry_id: entryId,
          user_id: userId,
          user_name: user.name,
          comment: comment,
          action: action
        }]);

      if (commentError) throw commentError;
    }

    // Handle workflow actions (same logic as diary)
    if (action === 'approve' && currentNode) {
      const newCompletionCount = (currentNode.completion_count || 0) + 1;
      const canReEdit = newCompletionCount < (currentNode.max_completions || 2);

      await supabase
        .from('form_workflow_nodes')
        .update({
          status: 'completed',
          completed_by: userId,
          completed_at: new Date().toISOString(),
          completion_count: newCompletionCount,
          can_re_edit: canReEdit
        })
        .eq('form_entry_id', entryId)
        .eq('node_order', entry.current_node_index);

      const nextNodeIndex = entry.current_node_index + 1;
      const nextNode = entry.form_workflow_nodes
        .find(node => node.node_order === nextNodeIndex);

      if (nextNode) {
        await supabase
          .from('form_workflow_nodes')
          .update({ status: 'pending' })
          .eq('form_entry_id', entryId)
          .eq('node_order', nextNodeIndex);

        await supabase
          .from('form_entries')
          .update({ current_node_index: nextNodeIndex })
          .eq('id', entryId);
      } else {
        await supabase
          .from('form_entries')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', entryId);
      }

      await sendWorkflowNotifications(entryId, 'approved', supabase, comment);

    } else if (action === 'reject') {
      await supabase
        .from('form_workflow_nodes')
        .update({
          status: 'rejected',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('form_entry_id', entryId)
        .eq('node_order', entry.current_node_index);

      const firstEditableNode = entry.form_workflow_nodes
        .filter(n => n.node_order >= 1)
        .sort((a, b) => a.node_order - b.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!firstEditableNode) {
        await supabase
          .from('form_entries')
          .update({
            status: 'permanently_rejected',
            current_node_index: null,
            current_active_node: null
          })
          .eq('id', entryId);

        return res.json({
          success: true,
          message: 'Form entry permanently rejected - no more edits allowed',
          permanently_rejected: true
        });
      }

      await supabase
        .from('form_entries')
        .update({
          status: 'rejected',
          current_node_index: firstEditableNode.node_order,
          current_active_node: firstEditableNode.node_id
        })
        .eq('id', entryId);

      await supabase
        .from('form_workflow_nodes')
        .update({ status: 'waiting' })
        .eq('form_entry_id', entryId)
        .gt('node_order', firstEditableNode.node_order);

      await supabase
        .from('form_workflow_nodes')
        .update({ status: 'pending' })
        .eq('form_entry_id', entryId)
        .eq('node_order', firstEditableNode.node_order);

      await sendWorkflowNotifications(entryId, 'rejected', supabase, comment);

    } else if (action === 'back') {
      const prevEditableNode = entry.form_workflow_nodes
        .filter(n => n.node_order < entry.current_node_index && n.node_order >= 1)
        .sort((a, b) => b.node_order - a.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!prevEditableNode) {
        return res.status(400).json({ 
          error: 'No previous node available for editing'
        });
      }
      
      await supabase
        .from('form_workflow_nodes')
        .update({
          status: 'sent_back',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('form_entry_id', entryId)
        .eq('node_order', entry.current_node_index);

      await supabase
        .from('form_workflow_nodes')
        .update({ status: 'pending' })
        .eq('form_entry_id', entryId)
        .eq('node_order', prevEditableNode.node_order);

      await supabase
        .from('form_entries')
        .update({ 
          current_node_index: prevEditableNode.node_order,
          current_active_node: prevEditableNode.node_id
        })
        .eq('id', entryId);

      await sendWorkflowNotifications(entryId, 'sent_back', supabase, comment);
    }

    res.json({
      success: true,
      message: 'Form entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating form entry:', error);
    res.status(500).json({ 
      error: 'Failed to update form entry',
      details: error.message 
    });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(entryId, action, supabase, comment = '') {
  try {
    console.log(`=== SENDING FORM NOTIFICATIONS FOR ${action.toUpperCase()} ===`);

    const { data: entry, error } = await supabase
      .from('form_entries')
      .select(`
        *,
        form_workflow_nodes(*),
        form_assignments(*)
      `)
      .eq('id', entryId)
      .single();

    if (error || !entry) {
      console.error('Failed to fetch form entry for notifications:', error);
      return;
    }

    const currentNode = entry.form_workflow_nodes
      .find(node => node.node_order === entry.current_node_index);

    let recipients = new Map();

    if (action === 'created') {
      if (currentNode && currentNode.executor_id) {
        const { data: executor } = await supabase
          .from('users')
          .select('*')
          .eq('id', currentNode.executor_id)
          .single();
        
        if (executor) {
          recipients.set(executor.id, {
            ...executor,
            role_in_workflow: 'executor',
            node_name: currentNode.node_name
          });
        }
      }

      const currentNodeCCs = entry.form_assignments.filter(assignment => 
        assignment.node_id === currentNode?.node_id
      );
      
      for (const assignment of currentNodeCCs) {
        if (!recipients.has(assignment.user_id)) {
          recipients.set(assignment.user_id, {
            id: assignment.user_id,
            name: assignment.user_name,
            email: assignment.user_email,
            role_in_workflow: 'cc',
            node_name: currentNode?.node_name
          });
        }
      }

    } else if (action === 'approved') {
      const nextNode = entry.form_workflow_nodes
        .find(node => node.node_order === entry.current_node_index);

      if (nextNode && nextNode.executor_id) {
        const { data: executor } = await supabase
          .from('users')
          .select('*')
          .eq('id', nextNode.executor_id)
          .single();
        
        if (executor) {
          recipients.set(executor.id, {
            ...executor,
            role_in_workflow: 'executor',
            node_name: nextNode.node_name
          });
        }
      }

    } else if (action === 'rejected' || action === 'sent_back') {
      const targetNode = entry.form_workflow_nodes
        .find(node => node.node_order === entry.current_node_index);

      if (targetNode) {
        if (action === 'rejected') {
          const { data: creator } = await supabase
            .from('users')
            .select('*')
            .eq('id', entry.created_by)
            .single();

          if (creator) {
            recipients.set(creator.id, {
              ...creator,
              role_in_workflow: 'admin',
              node_name: 'Admin Review'
            });
          }
        } else if (action === 'sent_back' && targetNode.executor_id) {
          const { data: executor } = await supabase
            .from('users')
            .select('*')
            .eq('id', targetNode.executor_id)
            .single();
          
          if (executor) {
            recipients.set(executor.id, {
              ...executor,
              role_in_workflow: 'executor',
              node_name: targetNode.node_name
            });
          }
        }
      }
    }

    const uniqueRecipients = Array.from(recipients.values());
    
    if (uniqueRecipients.length > 0) {
      await sendConsolidatedFormEmail(uniqueRecipients, entry, action, comment);
      
      // Create in-app notifications
      const executorIds = uniqueRecipients
        .filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin')
        .map(r => r.id);
      
      const ccUserIds = uniqueRecipients
        .filter(r => r.role_in_workflow === 'cc')
        .map(r => r.id);
      
      for (const executorId of executorIds) {
        await createFormAssignmentNotifications(supabase, {
          formType: 'custom_form',
          formId: entry.id,
          projectId: entry.project_id,
          projectName: entry.project_name,
          action,
          executorId,
          ccUserIds: [],
          comment
        });
      }
      
      for (const ccUserId of ccUserIds) {
        await createFormAssignmentNotifications(supabase, {
          formType: 'custom_form',
          formId: entry.id,
          projectId: entry.project_id,
          projectName: entry.project_name,
          action,
          executorId: null,
          ccUserIds: [ccUserId],
          comment
        });
      }
    }

  } catch (error) {
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send consolidated form email to all recipients
 */
async function sendConsolidatedFormEmail(recipients, entry, action, comment = '') {
  try {
    let subject = '';
    let message = '';
    const viewUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/forms`;

    const executors = recipients.filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin');
    const ccs = recipients.filter(r => r.role_in_workflow === 'cc');

    switch (action) {
      case 'created':
        subject = `New Form Submission: ${entry.template_name} - Action Required`;
        message = `
Dear Team,

A new form submission has been created for "${entry.template_name}" and requires attention.

Form: ${entry.template_name}
Project: ${entry.project_name}
Entry ID: ${entry.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): You are CC'd on this form submission for "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'approved':
        subject = `Form Approved: ${entry.template_name} - Next Action Required`;
        message = `
Dear Team,

A form submission for "${entry.template_name}" has been approved and moved to the next workflow step.

Form: ${entry.template_name}
Project: ${entry.project_name}
Entry ID: ${entry.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'rejected':
        subject = `Form Rejected: ${entry.template_name} - Admin Action Required`;
        message = `
Dear Team,

A form submission for "${entry.template_name}" has been rejected and requires admin attention.

Form: ${entry.template_name}
Project: ${entry.project_name}
Entry ID: ${entry.id}

${comment ? `Rejection Reason: ${comment}` : ''}

Please log in to MatrixTwin to review and resolve: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'sent_back':
        subject = `Form Sent Back: ${entry.template_name} - Review Required`;
        message = `
Dear Team,

A form submission for "${entry.template_name}" has been sent back for review.

Form: ${entry.template_name}
Project: ${entry.project_name}
Entry ID: ${entry.id}

${comment ? `Comments: ${comment}` : ''}

Please log in to MatrixTwin to review and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;
    }

    const allEmails = recipients.map(r => r.email);

    const emailResult = await sendEmail(
      allEmails,
      subject,
      message,
      message.replace(/\n/g, '<br>')
    );

    console.log(`Consolidated email sent successfully to ${allEmails.length} recipients for form ${entry.id}`);

  } catch (error) {
    console.error('Error sending consolidated form email:', error);
  }
}

module.exports = router; 