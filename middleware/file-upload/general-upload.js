const multer = require('multer');
const path = require('path');

// Configure in-memory storage
const storage = multer.memoryStorage();

// Define file filter to validate file types
const fileFilter = (req, file, cb) => {
  // List of accepted file extensions
  // Images: .jpg, .jpeg, .png, .gif, .webp, .svg
  // Documents: .pdf, .doc, .docx, .xls, .xlsx, .txt, .csv
  const acceptedExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'
  ];
  
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
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

module.exports = upload;
