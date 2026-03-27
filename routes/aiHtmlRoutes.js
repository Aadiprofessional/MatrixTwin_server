const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const BASETEN_API_KEY = process.env.BASETEN_API_KEY;
const BASETEN_CHAT_URL = 'https://inference.baseten.co/v1/chat/completions';

if (!BASETEN_API_KEY) {
  console.error('ERROR: BASETEN_API_KEY is not configured in environment variables');
} else {
  console.log('✓ BASETEN_API_KEY is configured');
}

// System prompt builder for HTML generation
const buildSystemPrompt = (docType) => {
  const base = `You are an expert HTML generator that creates professional, well-structured HTML documents. Your task is to generate clean, semantic HTML based on user requirements.

IMPORTANT GUIDELINES:
1. Always generate complete, valid HTML with proper DOCTYPE, head, and body tags
2. Use semantic HTML elements (header, main, section, article, aside, footer)
3. Include proper meta tags for charset and viewport
4. Use clean, professional styling with embedded CSS
5. Ensure all content is properly formatted and readable
6. Use CJK-safe fonts for Chinese content in the document body. For CHARTS specifically, ALL chart text (titles, axis labels, tick labels, legends, dataset labels) MUST be in English only, regardless of the document language or user request. Do NOT include Chinese or non-English characters in any chart text only most important it will be always in English.
7. Make the HTML responsive and mobile-friendly
8. Include proper heading hierarchy (H1 → H2 → H3, etc.)
9. Use appropriate text formatting (bold, italic, underline) sparingly but effectively
10. When images are relevant, insert <image>URL</image> tags at appropriate places using only the provided image URLs. Never display raw URLs in the document body.
11. Ensure all image URLs are clean without backticks or extra spaces
12. Keep the document professional and suitable for business use
13. Do not wrap the entire HTML in code blocks; output raw HTML directly. Only include chart definitions as inline \`\`\`chartjs\`\`\` blocks where appropriate.
14. Focus on creating content that can be easily converted to DOCX or Excel formats
15. Keep the total HTML output concise: under 800 words and under 12KB. Limit to at most 1–2 charts.

SPECIAL INSTRUCTIONS FOR SPREADSHEET/TABLE REQUESTS:
- If the user asks for data that should be in a spreadsheet, table, or Excel format, ALWAYS create proper HTML tables
- Use <table>, <thead>, <tbody>, <tr>, <th>, and <td> elements correctly
- Include meaningful column headers in <th> elements
- Organize data logically in rows and columns
- For lists, comparisons, data analysis, reports, or any structured data, use tables
- Avoid creating plain text or paragraphs when tabular data is more appropriate
- Example table structure:
  <table>
    <thead>
      <tr>
        <th>Column 1</th>
        <th>Column 2</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Data 1</td>
        <td>Data 2</td>
      </tr>
    </tbody>
  </table>

The generated HTML will be used to:
- Convert to DOCX documents via /api/document/htmlToDocx
- Convert to Excel files via /api/document/csvToXlsx (if the content contains tabular data)

Generate clean, professional HTML that renders well and converts properly to document formats.`;
  
  const chartRules = `

STRICT CHART RULES FOR DOCUMENTS:
- When a chart or visualization is appropriate, embed a chart definition inline using a chartjs code block:
  \`\`\`chartjs
  {
    "type": "<bar|line|pie|doughnut>",
    "data": {
      "labels": ["English labels only"],
      "datasets": [{
        "label": "Series (English)",
        "data": [...],
        "backgroundColor": [...],
        "borderColor": [...],
        "borderWidth": 2
      }]
    },
    "options": {
      "plugins": { 
        "title": { "display": true, "text": "Chart Title (English only)", "font": { "family": "Arial, Helvetica, Arial Unicode MS" } },
        "legend": { "display": true, "position": "top", "labels": { "font": { "family": "Arial, Helvetica, Arial Unicode MS" } } }
      },
      "scales": {
        "x": { "title": { "display": true, "text": "X Axis (English)", "font": { "family": "Arial, Helvetica, Arial Unicode MS" } }, "ticks": { "font": { "family": "Arial, Helvetica, Arial Unicode MS" } } },
        "y": { "title": { "display": true, "text": "Y Axis (English)", "font": { "family": "Arial, Helvetica, Arial Unicode MS" } }, "ticks": { "font": { "family": "Arial, Helvetica, Arial Unicode MS" } } }
      },
      "responsive": true
    }
  }
  \`\`\`
- Place the chartjs block exactly where the chart should appear within the HTML flow (between paragraphs, inside sections, etc.).
- Use pure JSON only inside the chartjs block (no comments, no trailing commas).
- Do not include <script> tags or external JS libraries.
- Ensure labels and dataset lengths match.
- Only use supported chart types: bar, line, pie, doughnut. Do not use scatter, bubble, polarArea, radar, or any unsupported features.`;

  if (docType && ['docx', 'document'].includes(docType.toLowerCase())) {
    return `${base}${chartRules}`;
  }
  return base;
};

 
 

// Helper: extract keyword-based image query from prompt
const extractImageQuery = (userPrompt) => {
  try {
    const cleaned = userPrompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const words = cleaned.split(/\s+/).filter(Boolean);
    const stop = new Set(['the','and','a','an','for','to','of','in','on','with','by','at','from','about','as','is','are','was','were','be','been','being','day','days','plan','make','create','generate','write','document','doc','html']);
    const filtered = words.filter(w => !stop.has(w));
    if (filtered.length === 0) return cleaned.trim() || userPrompt;
    const unique = [];
    for (const w of filtered) {
      if (!unique.includes(w)) unique.push(w);
      if (unique.length >= 6) break;
    }
    return unique.join(' ');
  } catch {
    return userPrompt;
  }
};

// Helper: call external image search webhook
const fetchImageUrls = async (q) => {
  try {
    const payload = { q, request_id: uuidv4() };
    const resp = await axios.post('https://n8n.matrixaiserver.com/webhook/searchImage', payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    const urlsField = resp.data?.urls;
    if (!urlsField || typeof urlsField !== 'string') return [];
    const urls = urlsField.split(/\r?\n/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u) && !/\/undefined\//i.test(u));
    const unique = [];
    for (const u of urls) {
      if (!unique.includes(u)) unique.push(u);
      if (unique.length >= 8) break;
    }
    return unique;
  } catch {
    return [];
  }
};

// Helper: transform <image>URL</image> to <img src="URL" />
const transformImagePlaceholdersToImg = (html) => {
  try {
    return html.replace(/<image>\s*([^<]+?)\s*<\/image>/gi, (m, url) => {
      const cleanUrl = String(url).replace(/`/g, '').trim();
      if (!/^https?:\/\//i.test(cleanUrl)) return '';
      return `<img src="${cleanUrl}" style="max-width:100%;height:auto;" />`;
    });
  } catch {
    return html;
  }
};

// Helper: generate concise image search keypoints
const generateImageKeypoints = async (userPrompt) => {
  if (!BASETEN_API_KEY) return [];
  try {
    const response = await axios.post(BASETEN_CHAT_URL, {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'You extract 3-8 short, simple image search keywords from the user request. Return ONLY the keywords separated by newlines, no explanations.' },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.2
    }, {
      headers: {
        'Authorization': `Api-Key ${BASETEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
    const content = response.data?.choices?.[0]?.message?.content || '';
    const lines = content.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
    const clean = lines.map(s => s.replace(/[^a-z0-9\s-]/gi, '').trim()).filter(s => s.length > 0);
    const out = [];
    for (const s of clean) {
      if (!out.includes(s)) out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
};

// Helper function to call Baseten Chat API
const callBasetenAPI = async (userPrompt, docType, imageUrls = []) => {
  if (!BASETEN_API_KEY) {
    console.error('BASETEN_API_KEY is not configured');
    return {
      success: false,
      error: 'BASETEN_API_KEY is not configured in environment variables'
    };
  }
  try {
    const messages = [
      { role: 'system', content: buildSystemPrompt(docType) }
    ];
    if (Array.isArray(imageUrls) && imageUrls.length > 0) {
      const list = imageUrls.map(u => `<image>${u}</image>`).join('\n');
      messages.push({
        role: 'system',
        content: `Use these image resources when relevant. Insert the tags inline:\n${list}\nUse no more than 4 images and ensure they enhance the content.`
      });
    }
    messages.push({ role: 'user', content: userPrompt });
    const response = await axios.post(BASETEN_CHAT_URL, {
      model: 'openai/gpt-oss-120b',
      messages,
      max_tokens: 5800,
      temperature: 0.2,
      top_p: 1
    }, {
      headers: {
        'Authorization': `Api-Key ${BASETEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 500000
    });
    if (response.data && Array.isArray(response.data.choices) && response.data.choices[0]?.message?.content) {
      return { success: true, html: response.data.choices[0].message.content.trim() };
    }
    throw new Error('Invalid response format from Baseten API');
  } catch (error) {
    console.error('Baseten API error:', error);
    let errorMessage = error.message;
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      if (status === 401) {
        errorMessage = 'Invalid Baseten API key. Please check BASETEN_API_KEY configuration.';
      } else if (status === 429) {
        errorMessage = 'Baseten rate limit exceeded. Please try again later.';
      } else {
        errorMessage = `Baseten API error (${status}): ${data?.error?.message || data?.message || 'Unknown error'}`;
      }
    }
    return { success: false, error: errorMessage };
  }
};

// Helper function to determine content type and call appropriate API
// Helper function to create CSV from HTML content when no tables are found
const createCSVFromContent = (html) => {
  try {
    console.log('[CSV CREATION] Creating CSV from HTML content');
    
    // Remove HTML tags and extract text content
    let textContent = html.replace(/<script[^>]*>.*?<\/script>/gis, ''); // Remove scripts
    textContent = textContent.replace(/<style[^>]*>.*?<\/style>/gis, ''); // Remove styles
    textContent = textContent.replace(/<[^>]*>/g, ' '); // Remove all HTML tags
    textContent = textContent.replace(/\s+/g, ' ').trim(); // Normalize whitespace
    
    // Decode HTML entities
    textContent = textContent.replace(/&nbsp;/g, ' ');
    textContent = textContent.replace(/&amp;/g, '&');
    textContent = textContent.replace(/&lt;/g, '<');
    textContent = textContent.replace(/&gt;/g, '>');
    textContent = textContent.replace(/&quot;/g, '"');
    
    if (!textContent || textContent.length < 10) {
      console.log('[CSV CREATION] Insufficient content for CSV creation');
      return null;
    }
    
    // Try to identify structured content patterns
    const lines = textContent.split(/[.\n\r]+/).filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      return null;
    }
    
    // Create a simple CSV structure
    const csvRows = ['Content'];
    
    // Add content lines as separate rows, limiting to reasonable length
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      let line = lines[i].trim();
      if (line.length > 0) {
        // Escape quotes and wrap in quotes if necessary
        line = line.replace(/"/g, '""');
        if (line.includes(',') || line.includes('\n') || line.includes('"')) {
          line = `"${line}"`;
        }
        csvRows.push(line);
      }
    }
    
    const result = csvRows.join('\n');
    console.log(`[CSV CREATION] Created CSV with ${csvRows.length} rows`);
    return result;
  } catch (error) {
    console.error('[CSV CREATION] Error creating CSV from content:', error);
    return null;
  }
};

// Helper function to enhance user prompt for better table generation
const enhancePromptForExcel = (userPrompt) => {
  const excelKeywords = ['table', 'spreadsheet', 'excel', 'csv', 'data', 'list', 'comparison', 'report', 'analysis'];
  const hasExcelIntent = excelKeywords.some(keyword => 
    userPrompt.toLowerCase().includes(keyword)
  );
  
  if (hasExcelIntent) {
    return `${userPrompt}

IMPORTANT: Please structure your response as an HTML table with proper headers and data rows. Use <table>, <thead>, <tbody>, <tr>, <th>, and <td> elements to organize the information in a tabular format that can be easily converted to Excel.`;
  }
  
  return userPrompt;
};
const isHtmlIncomplete = (html) => {
  try {
    const lower = (html || '').toLowerCase();
    if (lower.includes('<html') && !lower.includes('</html>')) return true;
    const openTables = (lower.match(/<table/g) || []).length;
    const closeTables = (lower.match(/<\/table>/g) || []).length;
    if (openTables !== closeTables) return true;
    const chartFence = (lower.match(/```chartjs/g) || []).length;
    const fences = (lower.match(/```/g) || []).length;
    if (chartFence > fences) return true;
    return false;
  } catch {
    return false;
  }
};

const sanitizeHtmlContent = (html) => {
  try {
    let out = html || '';
    out = out.replace(/<p[^>]*>\s*https?:\/\/\S+\s*<\/p>/gi, '');
    out = out.replace(/(^|\s)https?:\/\/\S+/gi, (m) => m.startsWith('<') ? m : '');
    out = out.replace(/```chartjs\s*({[\s\S]*?)(```|$)/gi, (m, json, end) => {
      return '```chartjs\n' + json.replace(/,\s*([}\]])/g, '$1') + (end === '```' ? '```' : '\n```');
    });
    if (!/<!doctype html>/i.test(out)) out = '<!doctype html>\n' + out;
    if (out.toLowerCase().includes('<html') && !out.toLowerCase().includes('</html>')) out += '\n</html>';
    if (out.toLowerCase().includes('<body') && !out.toLowerCase().includes('</body>')) out += '\n</body>';
    return out;
  } catch {
    return html;
  }
};

const callBasetenAPIWithRetry = async (userPrompt, docType, imageUrls = []) => {
  const first = await callBasetenAPI(userPrompt, docType, imageUrls);
  if (!first.success) return first;
  let html = first.html;
  if (!html || isHtmlIncomplete(html)) {
    try {
      const messages = [
        { role: 'system', content: buildSystemPrompt(docType) },
        ...(Array.isArray(imageUrls) && imageUrls.length > 0 ? [{ role: 'system', content: imageUrls.map(u => `<image>${u}</image>`).join('\n') }] : []),
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: html || '' },
        { role: 'user', content: 'Continue and finish the HTML completely. Close all tags, complete tables, ensure chart JSON is valid. Do not display raw URLs.' }
      ];
      const resp = await axios.post(BASETEN_CHAT_URL, {
        model: 'openai/gpt-oss-120b',
        messages,
        max_tokens: 2800,
        temperature: 0.2,
        top_p: 1
      }, {
        headers: {
          'Authorization': `Api-Key ${BASETEN_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 240000
      });
      const cont = resp.data?.choices?.[0]?.message?.content?.trim();
      if (cont && cont.length > 0) {
        html = cont;
      }
    } catch {}
  }
  return { success: true, html };
};

const processGeneratedHTML = async (html, baseUrl, docType = null) => {
  try {
    console.log(`[HTML PROCESSING] Processing HTML with baseUrl: ${baseUrl}, docType: ${docType}`);
    
    // If doc_type is specified, use it directly
    if (docType) {
      if (docType.toLowerCase() === 'excel' || docType.toLowerCase() === 'xlsx') {
        // Force Excel conversion
        console.log('[HTML PROCESSING] Converting to Excel format');
        const csvData = extractCSVFromHTML(html);
        if (csvData) {
        const response = await axios.post(`${baseUrl}/api/document/csvToXlsx`, {
          csvText: csvData
        }, {
          timeout: 180000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
          
          if (response.data && response.data.success) {
            return {
              success: true,
              type: 'excel',
              fileUrl: response.data.data.fileUrl,
              fileName: response.data.data.fileName,
              message: 'Your Excel file is ready!'
            };
          }
        } else {
          // If no table data found but Excel requested, try to create CSV from content
          console.log('[HTML PROCESSING] No tables found, attempting to create CSV from content');
          const contentCSV = createCSVFromContent(html);
          
          if (contentCSV) {
          const response = await axios.post(`${baseUrl}/api/document/csvToXlsx`, {
            csvText: contentCSV
          }, {
            timeout: 180000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
            
            if (response.data && response.data.success) {
              return {
                success: true,
                type: 'excel',
                fileUrl: response.data.data.fileUrl,
                fileName: response.data.data.fileName,
                message: 'Your Excel file is ready! (Content converted from HTML)'
              };
            }
          }
          
          // If content CSV creation also fails, return error instead of generic fallback
          console.log('[HTML PROCESSING] Failed to extract meaningful content for Excel conversion');
          return {
            success: false,
            error: 'Unable to convert the generated content to Excel format. The content may not contain structured data suitable for spreadsheets. Please try requesting tabular data or use document format instead.'
          };
        }
      } else if (docType.toLowerCase() === 'docx' || docType.toLowerCase() === 'document') {
        // Force DOCX conversion
        console.log('[HTML PROCESSING] Converting to DOCX format');
        const response = await axios.post(`${baseUrl}/api/document/htmlToDocx`, {
          htmlContent: html
        }, {
          timeout: 180000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.data && response.data.success) {
          return {
            success: true,
            type: 'document',
            fileUrl: response.data.data.fileUrl,
            fileBase64: response.data.data.fileBase64,
            fileName: response.data.data.fileName,
            message: 'Your document file is ready!'
          };
        }
      }
    }

    // Auto-detection logic (original behavior)
    console.log('[HTML PROCESSING] Using auto-detection for document type');
    const hasTable = html.toLowerCase().includes('<table') || 
                     html.toLowerCase().includes('csv') ||
                     html.toLowerCase().includes('spreadsheet') ||
                     html.toLowerCase().includes('data table');

    if (hasTable) {
      // Try to extract CSV data from HTML tables
      console.log('[HTML PROCESSING] Table detected, converting to Excel');
      const csvData = extractCSVFromHTML(html);
      if (csvData) {
        // Call CSV to XLSX API
        const response = await axios.post(`${baseUrl}/api/document/csvToXlsx`, {
          csvText: csvData
        }, {
          timeout: 180000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data && response.data.success) {
          return {
            success: true,
            type: 'excel',
            fileUrl: response.data.data.fileUrl,
            fileName: response.data.data.fileName,
            message: 'Your Excel file is ready!'
          };
        }
      }
    }

    // Default to DOCX conversion
    console.log('[HTML PROCESSING] Default conversion to DOCX');
    const response = await axios.post(`${baseUrl}/api/document/htmlToDocx`, {
      htmlContent: html
    }, {
      timeout: 180000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success) {
      return {
        success: true,
        type: 'document',
        fileUrl: response.data.data.fileUrl,
        fileBase64: response.data.data.fileBase64,
        fileName: response.data.data.fileName,
        message: 'Your document file is ready!'
      };
    } else {
      throw new Error('Failed to convert HTML to document');
    }
  } catch (error) {
    console.error('Error processing HTML:', error);
    
    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.code === 'ECONNREFUSED') {
      errorMessage = `Connection refused to document service at ${baseUrl}. The document conversion service may not be running.`;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Document conversion service timeout. Please try again.';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = `Document service not found at ${baseUrl}. Please check the service configuration.`;
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
};

// Helper function to extract CSV data from HTML tables
const extractCSVFromHTML = (html) => {
  try {
    console.log('[CSV EXTRACTION] Starting HTML to CSV conversion');
    
    // First, try to find tables
    const tableMatches = html.match(/<table[^>]*>(.*?)<\/table>/gis);
    if (!tableMatches || tableMatches.length === 0) {
      console.log('[CSV EXTRACTION] No tables found in HTML');
      return null;
    }

    console.log(`[CSV EXTRACTION] Found ${tableMatches.length} table(s)`);
    
    // Process the first table (or combine multiple tables)
    const allRows = [];
    
    for (let tableIndex = 0; tableIndex < tableMatches.length; tableIndex++) {
      const tableContent = tableMatches[tableIndex];
      console.log(`[CSV EXTRACTION] Processing table ${tableIndex + 1}`);
      
      // Extract table rows more carefully
      const rowMatches = tableContent.match(/<tr[^>]*>(.*?)<\/tr>/gis);
      if (!rowMatches) {
        console.log(`[CSV EXTRACTION] No rows found in table ${tableIndex + 1}`);
        continue;
      }

      console.log(`[CSV EXTRACTION] Found ${rowMatches.length} rows in table ${tableIndex + 1}`);

      for (const rowMatch of rowMatches) {
        const cells = [];
        
        // Match both th and td elements
        const cellMatches = rowMatch.match(/<t[hd][^>]*>(.*?)<\/t[hd]>/gis);
        if (cellMatches) {
          for (const cellMatch of cellMatches) {
            // Remove HTML tags and clean up text
            let cellText = cellMatch.replace(/<[^>]*>/g, '').trim();
            
            // Handle special characters and escape quotes
            cellText = cellText.replace(/"/g, '""'); // Escape quotes for CSV
            cellText = cellText.replace(/\s+/g, ' '); // Normalize whitespace
            cellText = cellText.replace(/&nbsp;/g, ' '); // Replace non-breaking spaces
            cellText = cellText.replace(/&amp;/g, '&'); // Decode HTML entities
            cellText = cellText.replace(/&lt;/g, '<');
            cellText = cellText.replace(/&gt;/g, '>');
            
            // Wrap in quotes if contains comma, newline, or quote
            if (cellText.includes(',') || cellText.includes('\n') || cellText.includes('"')) {
              cellText = `"${cellText}"`;
            }
            
            cells.push(cellText);
          }
          
          if (cells.length > 0) {
            allRows.push(cells.join(','));
          }
        }
      }
      
      // Add separator between tables if multiple tables
      if (tableIndex < tableMatches.length - 1 && allRows.length > 0) {
        allRows.push(''); // Empty row separator
      }
    }

    if (allRows.length === 0) {
      console.log('[CSV EXTRACTION] No valid rows extracted from tables');
      return null;
    }

    const csvResult = allRows.join('\n');
    console.log(`[CSV EXTRACTION] Successfully extracted ${allRows.length} rows`);
    console.log('[CSV EXTRACTION] Sample CSV data:', csvResult.substring(0, 200) + '...');
    
    return csvResult;
  } catch (error) {
    console.error('[CSV EXTRACTION] Error extracting CSV from HTML:', error);
    return null;
  }
};

const tryParseJsonString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const resolveProvidedContent = (body = {}, query = {}) => {
  const providedContent = body.input_content ||
    body.ai_response ||
    body.response_content ||
    body.generated_content ||
    body.htmlContent ||
    body.html_content ||
    body.content ||
    query.input_content ||
    query.ai_response ||
    query.response_content ||
    query.generated_content ||
    query.htmlContent ||
    query.html_content ||
    query.content;

  const csvText = body.csvText || body.csv_text || query.csvText || query.csv_text;
  const workbookData = body.workbookData || body.xlsxData || body.sheetData || query.workbookData || query.xlsxData || query.sheetData;

  return {
    providedContent,
    csvText,
    workbookData
  };
};

// Main AI HTML generation endpoint
const handleGenerateHtml = async (req, res) => {
  // Handle OPTIONS requests for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log('Request to /generateHTML endpoint:', req.method);
  console.log('Request body:', req.body);

  try {
    // Extract parameters from either query or body (following imageRoutes.js pattern)
    const user_prompt = req.body.user_prompt || req.query.user_prompt;
    const doc_type = req.body.doc_type || req.query.doc_type;
    const { providedContent, csvText, workbookData } = resolveProvidedContent(req.body, req.query);
    const hasProvidedContent = Boolean(providedContent || csvText || workbookData);

    // Validate required parameters
    if (!user_prompt && !hasProvidedContent) {
      return res.status(400).json({
        success: false,
        message: 'Provide either user_prompt or one of input_content/csvText/workbookData'
      });
    }

    // Validate doc_type if provided
    if (doc_type && !['excel', 'xlsx', 'docx', 'document'].includes(doc_type.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'doc_type must be one of: excel, xlsx, docx, document'
      });
    }

    console.log('Generating document request received');
    if (doc_type) {
      console.log('Requested document type:', doc_type);
    }

    if (hasProvidedContent && !doc_type) {
      return res.status(400).json({
        success: false,
        message: 'doc_type is required when sending pre-generated content'
      });
    }

    // Determine base URL for API calls
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers['host'] || '');
    const baseUrl = hostHeader ? `${proto}://${hostHeader}` : (process.env.BASE_URL || process.env.API_URL || `${proto}://localhost:${process.env.PORT || 3000}`);

    console.log(`[HTML PROCESSING] Using base URL: ${baseUrl}`);

    if (hasProvidedContent) {
      const normalizedDocType = doc_type.toLowerCase();

      if (normalizedDocType === 'excel' || normalizedDocType === 'xlsx') {
        let workbookPayload = workbookData;
        let csvPayload = csvText;
        let htmlPayload = null;

        if (!workbookPayload && !csvPayload && providedContent) {
          if (typeof providedContent === 'object') {
            workbookPayload = providedContent;
          } else if (typeof providedContent === 'string') {
            const parsed = tryParseJsonString(providedContent);
            if (parsed && parsed.sheets) {
              workbookPayload = parsed;
            } else {
              htmlPayload = providedContent;
            }
          }
        }

        let processResult;

        if (workbookPayload) {
          const response = await axios.post(`${baseUrl}/api/document/csvToXlsx`, {
            workbookData: workbookPayload
          }, {
            timeout: 180000,
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (!response.data || !response.data.success) {
            return res.status(500).json({
              success: false,
              message: 'Failed to process workbook data for Excel conversion'
            });
          }

          processResult = {
            success: true,
            type: 'excel',
            fileUrl: response.data.data.fileUrl,
            fileBase64: response.data.data.fileBase64,
            fileName: response.data.data.fileName,
            message: 'Your Excel file is ready!'
          };
        } else if (csvPayload) {
          const response = await axios.post(`${baseUrl}/api/document/csvToXlsx`, {
            csvText: csvPayload
          }, {
            timeout: 180000,
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (!response.data || !response.data.success) {
            return res.status(500).json({
              success: false,
              message: 'Failed to process CSV content for Excel conversion'
            });
          }

          processResult = {
            success: true,
            type: 'excel',
            fileUrl: response.data.data.fileUrl,
            fileBase64: response.data.data.fileBase64,
            fileName: response.data.data.fileName,
            message: 'Your Excel file is ready!'
          };
        } else {
          const sanitized = sanitizeHtmlContent(htmlPayload || '');
          const htmlWithImages = transformImagePlaceholdersToImg(sanitized);
          processResult = await processGeneratedHTML(htmlWithImages, baseUrl, doc_type);
        }

        return res.status(200).json({
          success: true,
          message: `<p>✅ ${processResult.message}</p><p>🤖 Your Excel file is ready for download.</p>`,
          fileUrl: processResult.fileUrl,
          fileBase64: processResult.fileBase64,
          fileName: processResult.fileName,
          fileType: 'excel'
        });
      }

      const htmlString = typeof providedContent === 'string' ? providedContent : JSON.stringify(providedContent || '');
      const sanitized = sanitizeHtmlContent(htmlString);
      const htmlWithImages = transformImagePlaceholdersToImg(sanitized);
      const processResult = await processGeneratedHTML(htmlWithImages, baseUrl, doc_type);

      if (!processResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to process provided HTML',
          error: processResult.error
        });
      }

      return res.status(200).json({
        success: true,
        message: `<p>✅ ${processResult.message}</p><p>🤖 Your document is ready for download.</p>`,
        fileUrl: processResult.fileUrl,
        fileBase64: processResult.fileBase64,
        fileName: processResult.fileName,
        fileType: processResult.type
      });
    }

    console.log('Generating HTML for prompt:', user_prompt);
    // Enhance prompt for Excel/spreadsheet requests
    let enhancedPrompt = user_prompt;
    if (doc_type && (doc_type.toLowerCase() === 'excel' || doc_type.toLowerCase() === 'xlsx')) {
      enhancedPrompt = enhancePromptForExcel(user_prompt);
      console.log('Enhanced prompt for Excel generation');
    }

    let keypoints = await generateImageKeypoints(user_prompt);
    if (!keypoints || keypoints.length === 0) {
      const imageQuery = extractImageQuery(user_prompt);
      keypoints = imageQuery ? [imageQuery] : [];
    }
    const imageUrlsCollected = [];
    for (const kp of keypoints.slice(0, 4)) {
      try {
        const urls = await fetchImageUrls(kp);
        for (const u of urls) {
          if (!imageUrlsCollected.includes(u)) imageUrlsCollected.push(u);
          if (imageUrlsCollected.length >= 8) break;
        }
      } catch {}
      if (imageUrlsCollected.length >= 8) break;
    }

    const htmlResult = await callBasetenAPIWithRetry(enhancedPrompt, doc_type, imageUrlsCollected);
    
    let finalHTML = htmlResult.success ? htmlResult.html : null;
    if (!finalHTML) {
      return res.status(500).json({
        success: false,
        message: 'AI HTML generation failed',
        error: htmlResult.error || 'No HTML content returned'
      });
    }
    if (finalHTML.length > 20000) {
      finalHTML = finalHTML.slice(0, 20000);
    }

    console.log('HTML generated successfully, length:', htmlResult.html.length);

    const sanitized = sanitizeHtmlContent(finalHTML);
    const htmlWithImages = transformImagePlaceholdersToImg(sanitized);
    const processResult = await processGeneratedHTML(htmlWithImages, baseUrl, doc_type);

    if (!processResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to process generated HTML',
        error: processResult.error
      });
    }

    // Return HTML formatted message with URL
    const htmlMessage = `
<p>✅ ${processResult.message}</p>
<p>🤖 Your ${processResult.type === 'excel' ? 'Excel file' : 'document'} is ready for download.</p>
`;

    // Return JSON response with HTML message in the message field
    return res.status(200).json({
      success: true,
      message: htmlMessage,
      fileUrl: processResult.fileUrl,
      fileBase64: processResult.fileBase64,
      fileName: processResult.fileName,
      fileType: processResult.type
    });

  } catch (error) {
    console.error('Error in AI HTML generation:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

router.all('/generateHTML', handleGenerateHtml);
router.all('/generateHtml', handleGenerateHtml);

module.exports = router;
