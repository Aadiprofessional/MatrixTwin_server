const express = require('express');
const router = express.Router();
const HTMLtoDOCX = require('html-to-docx');
const xlsx = require('xlsx');

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

    const base64Data = fileBuffer.toString('base64');
    const fileName = `document_${Date.now()}.docx`;
    
    // In a real production environment, you might upload this to S3/Supabase storage
    // For now, we return the base64 data directly or a data URI
    
    // Construct a data URI for client-side download
    const fileUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Data}`;

    return res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileBase64: base64Data,
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
    const { csvText } = req.body;
    
    if (!csvText) {
      return res.status(400).json({
        success: false,
        message: 'csvText is required'
      });
    }

    // Parse CSV to workbook
    const workbook = xlsx.read(csvText, { type: 'string', raw: true });
    
    // Write workbook to buffer
    const fileBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    const base64Data = fileBuffer.toString('base64');
    const fileName = `spreadsheet_${Date.now()}.xlsx`;
    
    // Construct a data URI for client-side download
    const fileUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64Data}`;

    return res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileBase64: base64Data,
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
