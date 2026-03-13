const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const upload = require('../middleware/file-upload/general-upload');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Helper to upload file to Supabase Storage
const uploadToStorage = async (supabase, file, userId, type) => {
  const fileExt = path.extname(file.originalname);
  const fileName = `${uuidv4()}${fileExt}`;
  const filePath = `${userId}/${type}/${fileName}`;

  // Check if bucket exists, if not try to create it (optional, better to ensure it exists beforehand)
  // For now, we assume 'user-uploads' bucket exists. 
  // If you need to use a different bucket, change the name here.
  const BUCKET_NAME = 'user-uploads';

  const { data, error } = await supabase
    .storage
    .from(BUCKET_NAME)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) throw error;
  
  // Get public URL
  const { data: { publicUrl } } = supabase
    .storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return publicUrl;
};

// Generic upload handler
const handleUpload = (type) => async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Ensure user ID is available
    const userId = req.user ? req.user.id : null;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const fileUrl = await uploadToStorage(req.supabase, req.file, userId, type);

    // Save metadata to database
    const { data, error } = await req.supabase
      .from('user_uploads')
      .insert({
        user_id: userId,
        file_type: type,
        file_url: fileUrl,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'File uploaded successfully',
      file: data
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error uploading file', error: error.message });
  }
};

// Routes for different file types
router.post('/signature', auth, upload.single('file'), handleUpload('signature'));
router.post('/attachment', auth, upload.single('file'), handleUpload('attachment'));
router.post('/image', auth, upload.single('file'), handleUpload('image'));
router.post('/pic', auth, upload.single('file'), handleUpload('pic'));

// Get all files for user, grouped by type
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    const { data, error } = await req.supabase
      .from('user_uploads')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by type
    const groupedFiles = {
      signature: [],
      attachment: [],
      image: [],
      pic: []
    };

    data.forEach(file => {
      if (groupedFiles[file.file_type]) {
        groupedFiles[file.file_type].push(file);
      } else {
        // Handle potential new types or fallback
        if (!groupedFiles[file.file_type]) {
            groupedFiles[file.file_type] = [];
        }
        groupedFiles[file.file_type].push(file);
      }
    });

    res.json(groupedFiles);

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ message: 'Error fetching files', error: error.message });
  }
});

module.exports = router;
