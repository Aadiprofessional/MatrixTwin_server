const express = require('express');
const router = express.Router();
const { bimfaceQueue, taskStatus } = require('../queues/bimface-queue');
const upload = require('../middleware/file-upload/multer-config');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');

// Apply CORS specifically for BIMFace routes
router.use(cors({
  origin: true, // Reflect the request origin instead of just '*'
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Content-Disposition'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// API 1: Upload file and start processing
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Set CORS headers explicitly for this endpoint
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { name, uid, project_id, user_name } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate a unique file ID
    const fileId = crypto.randomUUID();
    
    // Create a file name if not provided
    const fileName = name || file.originalname;

    console.log(`Processing upload for file: ${fileName} (${file.size} bytes)`);

    // Add job to the queue with file data only
    // Token will be generated automatically in the queue process
    const job = await bimfaceQueue.add({
      fileId,
      name: fileName,
      fileBuffer: file.buffer,
      uid,
      project_id,
      user_name
    });

    // Create initial record in the database
    console.log('Supabase client available:', !!req.supabase);
    if (req.supabase && uid) {
      try {
        console.log(`Inserting initial record into database for fileId: ${fileId}, userId: ${uid}`);
        
        // Make sure we have a valid UUID format
        let validUid = uid;
        // Only attempt to validate/clean if it's not already a valid UUID
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
          console.log('Warning: uid is not in standard UUID format, attempting to clean it');
          // Try to remove any non-alphanumeric characters except dashes
          validUid = uid.replace(/[^a-f0-9\-]/gi, '');
          console.log(`Cleaned userId: ${validUid}`);
        }
        
        const insertData = {
          id: fileId,
          file_name: fileName,
          status: 'processing',
          step: 'upload_started',
          progress: 0,
          project_id: project_id || null,
          user_name: user_name || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          file_url: 'uploading' // Add a temporary file_url to satisfy not-null constraint
        };
        
        // Add user_id only if it's valid to prevent type issues
        if (validUid && validUid.length > 0) {
          insertData.user_id = validUid;
        }
        
        const { data, error } = await req.supabase
          .from('bim_process_logs')
          .insert(insertData);
          
        if (error) {
          console.error('Database insert error details:', error);
        } else {
          console.log('Database insert successful:', data);
        }
      } catch (dbError) {
        console.error('Error creating initial database record:', dbError);
      }
    } else {
      console.log('Skipping database insert: supabase client or uid not available');
      if (!req.supabase) console.log('Supabase client is not attached to the request object');
      if (!uid) console.log('User ID is not provided in the request');
    }

    // Respond with job ID and file ID
    res.status(200).json({
      success: true,
      message: 'File upload started',
      jobId: job.id,
      fileId
    });
  } catch (error) {
    console.error('Error in file upload API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API 2: Check job status
router.get('/status/:jobId', async (req, res) => {
  try {
    // Set CORS headers explicitly for this endpoint
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { jobId } = req.params;

    // Check if job exists in memory
    if (!taskStatus[jobId]) {
      // If not in memory, try to get it from Bull queue
      const job = await bimfaceQueue.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }
      
      // Job exists in queue but not in memory status map
      // Update database with status if we have supabase client
      console.log('Status API: Supabase client available:', !!req.supabase);
      if (req.supabase && job.data.fileId) {
        const fileId = job.data.fileId;
        try {
          console.log(`Updating database record for fileId: ${fileId}`);
          const { data, error } = await req.supabase
            .from('bim_process_logs')
            .update({
              status: job.finishedOn ? 'completed' : 'processing',
              progress: job.progress || 0,
              step: job.finishedOn ? 'completed' : 'processing',
              updated_at: new Date().toISOString()
            })
            .eq('id', fileId);
            
          if (error) {
            console.error('Database update error details:', error);
          } else {
            console.log('Database update successful:', data);
          }
        } catch (dbError) {
          console.error('Error updating database:', dbError);
        }
      } else {
        if (!req.supabase) console.log('Supabase client is not attached to the request object');
        if (!job.data.fileId) console.log('FileId is not available in job data');
      }
      
      return res.status(200).json({
        success: true,
        jobId,
        status: job.finishedOn ? 'completed' : 'processing',
        progress: job.progress || 0,
        result: job.returnvalue || null
      });
    }

    const task = taskStatus[jobId];
    
    // Update database with status information
    if (req.supabase && task.fileId) {
      const fileId = task.fileId;
      try {
        const updateData = {
          status: task.status,
          step: task.currentStep || 'unknown',
          progress: task.progress || 0,
          updated_at: new Date().toISOString()
        };
        
        // If task is completed or failed, also update additional data
        if (task.status === 'completed' && task.result) {
          updateData.file_id = task.result.fileId;
          updateData.token = task.result.token;
          updateData.thumbnail = JSON.stringify(task.result.thumbnails || []);
          
          // Update file_url with the viewer URL when complete
          if (task.result.viewerUrl) {
            updateData.file_url = task.result.viewerUrl;
          }
        } else if (task.status === 'failed' && task.result) {
          updateData.error = JSON.stringify(task.result);
          
          // Update file_url with error status
          updateData.file_url = 'error_processing';
        }
        
        await req.supabase
          .from('bim_process_logs')
          .update(updateData)
          .eq('id', fileId);
      } catch (dbError) {
        console.error('Error updating database:', dbError);
      }
    }

    // Return detailed response based on status
    return res.status(200).json({
      success: true,
      jobId,
      fileId: task.fileId,
      status: task.status,
      currentStep: task.currentStep || 'unknown',
      progress: task.progress || 0,
      steps: task.steps || {},
      result: task.status === 'completed' ? task.result : null,
      error: task.status === 'failed' ? task.result : null
    });
  } catch (error) {
    console.error('Error in job status API:', error);
    res.status(500).json({
      success: false, 
      error: error.message
    });
  }
});

// API 3: Get viewer URL for a job
router.get('/viewer/:jobId', async (req, res) => {
  try {
    // Set CORS headers explicitly for this endpoint
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { jobId } = req.params;

    // Check if job exists and is completed
    if (!taskStatus[jobId] || taskStatus[jobId].status !== 'completed') {
      return res.status(404).json({
        success: false,
        error: 'Completed job not found'
      });
    }

    const task = taskStatus[jobId];
    
    if (!task.result || !task.result.viewerUrl) {
      return res.status(404).json({
        success: false,
        error: 'Viewer URL not available'
      });
    }

    // Return the viewer URL
    return res.status(200).json({
      success: true,
      viewerUrl: task.result.viewerUrl,
      token: task.result.token,
      databagId: task.result.databagId,
      thumbnails: task.result.thumbnails
    });
  } catch (error) {
    console.error('Error getting viewer URL:', error);
    res.status(500).json({
      success: false, 
      error: error.message
    });
  }
});

// API 4: Get view token ID for a BIMFace file
router.get('/getviewid', async (req, res) => {
  try {
    // Set CORS headers explicitly for this endpoint
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { fileId, token } = req.query;

    if (!fileId || !token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: fileId and token'
      });
    }

    // Step 1: Check file translation status
    let translationStatus;
    try {
      const translationResponse = await axios.get(
        `https://api.bimface.com/translate?fileId=${fileId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      translationStatus = translationResponse.data;
    } catch (error) {
      console.error('Error checking translation status:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to check translation status',
        details: error.response?.data || error.message
      });
    }

    // Check if response is successful
    if (translationStatus.code !== 'success') {
      return res.status(400).json({
        success: false,
        error: 'Translation status check failed',
        details: translationStatus
      });
    }

    // Check the status of the translation
    if (translationStatus.data.status === 'processing') {
      // If still processing, return this information
      // Update the database status
      if (req.supabase) {
        try {
          await req.supabase
            .from('bim_process_logs')
            .update({
              status: 'processing',
              step: 'translation',
              updated_at: new Date().toISOString()
            })
            .eq('file_id', fileId);
        } catch (dbError) {
          console.error('Error updating database:', dbError);
        }
      }

      return res.status(200).json({
        success: true,
        status: 'processing',
        message: 'Translation is still in progress',
        translationStatus: translationStatus.data
      });
    }

    // If translation is successful, proceed to get the view token
    if (translationStatus.data.status === 'success') {
      let viewToken;
      try {
        const viewTokenResponse = await axios.get(
          `https://api.bimface.com/view/token?fileId=${fileId}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        if (viewTokenResponse.data.code === 'success') {
          viewToken = viewTokenResponse.data.data;
          
          // Update the database with the view token
          if (req.supabase) {
            try {
              await req.supabase
                .from('bim_process_logs')
                .update({
                  status: 'completed',
                  step: 'view_token_generated',
                  viewtoken: viewToken,
                  thumbnail: JSON.stringify(translationStatus.data.thumbnail),
                  updated_at: new Date().toISOString(),
                  // Include a file_url for viewer access
                  file_url: `https://viewer.bimface.com/?viewToken=${viewToken}&fileId=${fileId}`
                })
                .eq('file_id', fileId);
            } catch (dbError) {
              console.error('Error updating database:', dbError);
            }
          }

          return res.status(200).json({
            success: true,
            status: 'completed',
            viewToken: viewToken,
            translationStatus: translationStatus.data
          });
        } else {
          return res.status(400).json({
            success: false,
            error: 'Failed to get view token',
            details: viewTokenResponse.data
          });
        }
      } catch (error) {
        console.error('Error getting view token:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to get view token',
          details: error.response?.data || error.message
        });
      }
    }

    // If translation failed
    return res.status(400).json({
      success: false,
      status: 'failed',
      error: 'Translation failed',
      details: translationStatus.data
    });
  } catch (error) {
    console.error('Error in getviewid API:', error);
    res.status(500).json({
      success: false, 
      error: error.message
    });
  }
});

// API 5: Get fresh view token for a fileId (standalone - no database updates)
router.get('/getfreshviewtoken/:fileId', async (req, res) => {
  try {
    // Set CORS headers explicitly for this endpoint
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: fileId'
      });
    }

    // BIMFace API credentials
    const appKey = 'P9v85Mw7uk1bmKTnDpDVucorielyQOHX';
    const appSecret = 'E06BiIPhayMEnWl5k1PLzlBEaK5c34BL';
    
    // Step 1: Get fresh access token
    let accessToken;
    try {
      // Create base64 encoded credentials
      const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
      
      const tokenResponse = await axios.post(
        'https://api.bimface.com/oauth2/token',
        {},
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (tokenResponse.data.code !== 'success') {
        return res.status(400).json({
          success: false,
          error: 'Failed to get access token',
          details: tokenResponse.data
        });
      }
      
      accessToken = tokenResponse.data.data.token;
      console.log(`Got fresh access token: ${accessToken}`);
    } catch (error) {
      console.error('Error getting access token:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get access token',
        details: error.response?.data || error.message
      });
    }

    // Step 2: Get view token using the fresh access token
    try {
      const viewTokenResponse = await axios.get(
        `https://api.bimface.com/view/token?fileId=${fileId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (viewTokenResponse.data.code === 'success') {
        const viewToken = viewTokenResponse.data.data;
        
        return res.status(200).json({
          success: true,
          fileId: fileId,
          viewToken: viewToken,
          accessToken: accessToken,
          viewerUrl: `https://viewer.bimface.com/?viewToken=${viewToken}&fileId=${fileId}`
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Failed to get view token',
          details: viewTokenResponse.data
        });
      }
    } catch (error) {
      console.error('Error getting view token:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get view token',
        details: error.response?.data || error.message
      });
    }
  } catch (error) {
    console.error('Error in getfreshviewtoken API:', error);
    res.status(500).json({
      success: false, 
      error: error.message
    });
  }
});

module.exports = router; 