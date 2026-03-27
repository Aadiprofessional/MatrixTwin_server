const express = require('express');
const router = express.Router();
const HTMLtoDOCX = require('html-to-docx');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');

// Helper to upload file to Supabase Storage
const uploadToSupabase = async (supabase, buffer, fileName, contentType) => {
  if (!supabase) throw new Error('Supabase client not available');
  
  // Use 'user-uploads' bucket or fallback to 'temp-files' if needed
  // Assuming 'user-uploads' exists as seen in other routes
  const BUCKET_NAME = 'user-uploads';
  const filePath = `generated-docs/${fileName}`;
  
  const { data, error } = await supabase
    .storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: contentType,
      upsert: false
    });

  if (error) throw error;
  
  const { data: { publicUrl } } = supabase
    .storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return publicUrl;
};

const sanitizeSheetName = (name, fallbackIndex) => {
  const fallback = `Sheet${fallbackIndex + 1}`;
  const raw = typeof name === 'string' && name.trim().length > 0 ? name.trim() : fallback;
  const cleaned = raw.replace(/[\\/?*[\]:]/g, ' ').trim();
  const limited = cleaned.slice(0, 31);
  return limited.length > 0 ? limited : fallback;
};

const buildWorkbookFromStructuredData = (workbookData) => {
  if (!workbookData || typeof workbookData !== 'object' || !Array.isArray(workbookData.sheets) || workbookData.sheets.length === 0) {
    throw new Error('workbookData.sheets is required and must contain at least one sheet');
  }

  const workbook = xlsx.utils.book_new();
  const usedNames = new Set();

  workbookData.sheets.forEach((sheet, index) => {
    const safeSheet = sheet && typeof sheet === 'object' ? sheet : {};
    let sheetName = sanitizeSheetName(safeSheet.name, index);
    while (usedNames.has(sheetName)) {
      sheetName = sanitizeSheetName(`${sheetName.slice(0, 28)}_${index + 1}`, index);
    }
    usedNames.add(sheetName);

    const columns = Array.isArray(safeSheet.columns) ? safeSheet.columns : [];
    const rows = Array.isArray(safeSheet.rows) ? safeSheet.rows : [];
    const aoa = [];

    if (columns.length > 0) {
      aoa.push(columns.map((cell) => (cell === null || cell === undefined ? '' : cell)));
    }

    rows.forEach((row) => {
      if (Array.isArray(row)) {
        aoa.push(row.map((cell) => (cell === null || cell === undefined ? '' : cell)));
      } else if (row && typeof row === 'object') {
        const values = columns.length > 0
          ? columns.map((key) => (row[key] === null || row[key] === undefined ? '' : row[key]))
          : Object.values(row).map((value) => (value === null || value === undefined ? '' : value));
        aoa.push(values);
      } else {
        aoa.push([row === null || row === undefined ? '' : row]);
      }
    });

    const worksheet = xlsx.utils.aoa_to_sheet(aoa.length > 0 ? aoa : [[]]);
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  return workbook;
};

// DOCX conversion endpoint
router.post('/htmlToDocx', async (req, res) => {
  try {
    const { htmlContent } = req.body;
    
    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        message: 'htmlContent is required'
      });
    }

    const fileBuffer = await HTMLtoDOCX(htmlContent, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    const fileName = `document_${uuidv4()}.docx`;
    let fileUrl;

    // Try to upload to Supabase if client is available
    if (req.supabase) {
      try {
        fileUrl = await uploadToSupabase(
          req.supabase, 
          fileBuffer, 
          fileName, 
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
      } catch (uploadError) {
        console.error('Supabase upload failed, falling back to data URI:', uploadError);
        // Fallback to base64 if upload fails
        fileUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${fileBuffer.toString('base64')}`;
      }
    } else {
      console.warn('Supabase client missing, using data URI');
      fileUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${fileBuffer.toString('base64')}`;
    }

    return res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileBase64: fileBuffer.toString('base64'),
        fileName
      }
    });

  } catch (error) {
    console.error('Error converting HTML to DOCX:', error);
    return res.status(500).json({
      success: false,
      message: 'Conversion failed',
      error: error.message
    });
  }
});

// Excel conversion endpoint
router.post('/csvToXlsx', async (req, res) => {
  try {
    const { csvText, workbookData } = req.body;
    
    if (!csvText && !workbookData) {
      return res.status(400).json({
        success: false,
        message: 'csvText or workbookData is required'
      });
    }

    let workbook;
    if (workbookData) {
      workbook = buildWorkbookFromStructuredData(workbookData);
    } else {
      workbook = xlsx.read(csvText, { type: 'string', raw: true });
    }
    
    // Write workbook to buffer
    const fileBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    const fileName = `spreadsheet_${uuidv4()}.xlsx`;
    let fileUrl;
    
    // Try to upload to Supabase if client is available
    if (req.supabase) {
      try {
        fileUrl = await uploadToSupabase(
          req.supabase, 
          fileBuffer, 
          fileName, 
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      } catch (uploadError) {
        console.error('Supabase upload failed, falling back to data URI:', uploadError);
        fileUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBuffer.toString('base64')}`;
      }
    } else {
      console.warn('Supabase client missing, using data URI');
      fileUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBuffer.toString('base64')}`;
    }

    return res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileBase64: fileBuffer.toString('base64'),
        fileName
      }
    });

  } catch (error) {
    console.error('Error converting CSV to XLSX:', error);
    return res.status(500).json({
      success: false,
      message: 'Conversion failed',
      error: error.message
    });
  }
});

module.exports = router;
