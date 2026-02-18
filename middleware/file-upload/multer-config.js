const multer = require('multer');
const path = require('path');

// Configure in-memory storage
const storage = multer.memoryStorage();

// Define file filter to validate file types
const fileFilter = (req, file, cb) => {
  // List of accepted file extensions for BIM models
  const acceptedExtensions = ['.nwd', '.rvt', '.ifc', '.dwg', '.dgn', '.skp', '.nwc', '.nwf'];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (acceptedExtensions.includes(ext)) {
    // Accept file
    cb(null, true);
  } else {
    // Reject file
    cb(new Error(`File type not allowed. Accepted types: ${acceptedExtensions.join(', ')}`), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
  },
});

module.exports = upload; 