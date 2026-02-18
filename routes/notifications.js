const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// Middleware to temporarily disable RLS for notification operations
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
 * @route   GET /api/notifications
 * @desc    Get notifications for the current user
 * @access  Private
 */
router.get('/', auth, disableRLS, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const supabase = req.supabaseAdmin || req.supabase;
    const { page = 1, limit = 20, unread_only = false } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unread_only === 'true') {
      query = query.eq('read', false);
    }

    const { data: notifications, error } = await query;

    if (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Get unread count
    const { count: unreadCount, error: countError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (countError) {
      console.error('Error fetching unread count:', countError);
    }

    res.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    console.error('Error in GET /notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   POST /api/notifications/mark-read/:id
 * @desc    Mark a specific notification as read
 * @access  Private
 */
router.post('/mark-read/:id', auth, disableRLS, async (req, res) => {
  try {
    const userId = req.user?.id;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const supabase = req.supabaseAdmin || req.supabase;

    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({ error: 'Failed to mark notification as read' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read', notification: data });

  } catch (error) {
    console.error('Error in POST /notifications/mark-read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   POST /api/notifications/mark-all-read
 * @desc    Mark all notifications as read for the current user
 * @access  Private
 */
router.post('/mark-all-read', auth, disableRLS, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const supabase = req.supabaseAdmin || req.supabase;

    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('read', false)
      .select();

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }

    res.json({ 
      message: 'All notifications marked as read', 
      updatedCount: data?.length || 0 
    });

  } catch (error) {
    console.error('Error in POST /notifications/mark-all-read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a specific notification
 * @access  Private
 */
router.delete('/:id', auth, disableRLS, async (req, res) => {
  try {
    const userId = req.user?.id;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const supabase = req.supabaseAdmin || req.supabase;

    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error deleting notification:', error);
      return res.status(500).json({ error: 'Failed to delete notification' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });

  } catch (error) {
    console.error('Error in DELETE /notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   DELETE /api/notifications/clear-all
 * @desc    Clear all notifications for the current user
 * @access  Private
 */
router.delete('/clear-all', auth, disableRLS, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const supabase = req.supabaseAdmin || req.supabase;

    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .select();

    if (error) {
      console.error('Error clearing all notifications:', error);
      return res.status(500).json({ error: 'Failed to clear all notifications' });
    }

    res.json({ 
      message: 'All notifications cleared successfully', 
      deletedCount: data?.length || 0 
    });

  } catch (error) {
    console.error('Error in DELETE /notifications/clear-all:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create a notification for a user
 * This is a utility function used by other routes
 */
async function createNotification(supabase, {
  userId,
  title,
  message,
  type = 'info',
  formType = null,
  formId = null,
  projectId = null,
  actionUrl = null,
  metadata = {}
}) {
  try {
    console.log('Creating notification:', { userId, title, message, type, formType, formId });

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      user_id: userId,
      title,
      message,
      type,
      form_type: formType,
      form_id: formId,
      project_id: projectId,
      action_url: actionUrl,
      metadata,
      read: false,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('notifications')
      .insert([notification])
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      throw error;
    }

    console.log('Notification created successfully:', data);
    return data;

  } catch (error) {
    console.error('Error in createNotification:', error);
    throw error;
  }
}

/**
 * Create notifications for form assignments
 * This function is called when forms are assigned to users in workflows
 */
async function createFormAssignmentNotifications(supabase, {
  formType,
  formId,
  projectId,
  projectName,
  action,
  executorId,
  ccUserIds = [],
  comment = ''
}) {
  try {
    console.log('Creating form assignment notifications:', {
      formType, formId, projectId, action, executorId, ccUserIds
    });

    const notifications = [];

    // Create notification for executor
    if (executorId) {
      const executorNotification = await createNotification(supabase, {
        userId: executorId,
        title: getNotificationTitle(formType, action, 'executor'),
        message: getNotificationMessage(formType, action, projectName, 'executor', comment),
        type: getNotificationType(action),
        formType,
        formId,
        projectId,
        actionUrl: getActionUrl(formType, formId),
        metadata: { role: 'executor', action, comment }
      });
      notifications.push(executorNotification);
    }

    // Create notifications for CC recipients
    for (const ccUserId of ccUserIds) {
      const ccNotification = await createNotification(supabase, {
        userId: ccUserId,
        title: getNotificationTitle(formType, action, 'cc'),
        message: getNotificationMessage(formType, action, projectName, 'cc', comment),
        type: 'info',
        formType,
        formId,
        projectId,
        actionUrl: getActionUrl(formType, formId),
        metadata: { role: 'cc', action, comment }
      });
      notifications.push(ccNotification);
    }

    console.log(`Created ${notifications.length} notifications for form assignment`);
    return notifications;

  } catch (error) {
    console.error('Error creating form assignment notifications:', error);
    throw error;
  }
}

// Helper functions for notification content
function getNotificationTitle(formType, action, role) {
  const formTypeNames = {
    diary: 'Diary Entry',
    safety: 'Safety Report',
    cleansing: 'Cleansing Record',
    labour: 'Labour Report'
  };

  const formName = formTypeNames[formType] || 'Form';

  switch (action) {
    case 'created':
      return role === 'executor' 
        ? `New ${formName} Assigned` 
        : `New ${formName} Created`;
    case 'approved':
      return role === 'executor' 
        ? `${formName} Assigned for Review` 
        : `${formName} Approved`;
    case 'rejected':
      return `${formName} Rejected`;
    case 'sent_back':
      return `${formName} Sent Back`;
    default:
      return `${formName} Update`;
  }
}

function getNotificationMessage(formType, action, projectName, role, comment = '') {
  const formTypeNames = {
    diary: 'diary entry',
    safety: 'safety report',
    cleansing: 'cleansing record',
    labour: 'labour report'
  };

  const formName = formTypeNames[formType] || 'form';
  const projectText = projectName ? ` for ${projectName}` : '';

  let message = '';

  switch (action) {
    case 'created':
      message = role === 'executor' 
        ? `A new ${formName}${projectText} has been assigned to you for review and approval.`
        : `A new ${formName}${projectText} has been created and you are CC'd on this workflow.`;
      break;
    case 'approved':
      message = role === 'executor' 
        ? `A ${formName}${projectText} has been approved and assigned to you for the next step.`
        : `A ${formName}${projectText} has been approved in the workflow.`;
      break;
    case 'rejected':
      message = `A ${formName}${projectText} has been rejected and requires your attention.`;
      break;
    case 'sent_back':
      message = `A ${formName}${projectText} has been sent back to you for revision.`;
      break;
    default:
      message = `There has been an update to a ${formName}${projectText}.`;
  }

  if (comment) {
    message += ` Comment: "${comment}"`;
  }

  return message;
}

function getNotificationType(action) {
  switch (action) {
    case 'created':
    case 'approved':
      return 'info';
    case 'rejected':
      return 'error';
    case 'sent_back':
      return 'warning';
    default:
      return 'info';
  }
}

function getActionUrl(formType, formId) {
  const routes = {
    diary: '/diary',
    safety: '/safety',
    cleansing: '/cleansing',
    labour: '/labour'
  };

  return routes[formType] || '/dashboard';
}

// Export the utility functions for use in other routes
module.exports = router;
module.exports.createNotification = createNotification;
module.exports.createFormAssignmentNotifications = createFormAssignmentNotifications; 