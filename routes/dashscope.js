const express = require('express');
const router = express.Router();
const axios = require('axios');

// Environment variables
const API_KEY = 'sk-58ed6751f00d4ad9ac9d606ee085b065';
const APP_ID = '33b3f866ff054f2eb98d17c174239fc8';
const QVQ_MODEL = 'qvq-max'; // DashScope QVQ model

// Simple debugging for all requests
router.use((req, res, next) => {
  console.log(`[DashScope Route] ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

// Voice call endpoint
router.post('/voice-call', async (req, res) => {
  try {
    const { prompt, stream = false, incremental_output = false, memory_id = null } = req.body;
    console.log('[DashScope] Received voice call request with prompt:', prompt);
    
    const requestData = {
      input: {
        prompt: prompt || 'Hello, how can I help you?'
      },
      parameters: {
        stream: stream,
        incremental_output: incremental_output,
        response_format: {
          language: "en" // Force English response
        }
      },
      debug: {}
    };
    
    // Add memory_id if provided
    if (memory_id) {
      requestData.session_id = memory_id;
    }
    
    console.log('[DashScope] Sending request to DashScope API:', requestData);
    
    const response = await axios.post(
      `https://dashscope.aliyuncs.com/api/v1/apps/${APP_ID}/completion`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'Accept-Language': 'en-US,en' // Add language header
        }
      }
    );

    console.log('[DashScope] Response from API:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('DashScope voice call error:', error.response?.data || error.message);
    
    // Return error details for troubleshooting
    res.status(error.response?.status || 500).json({
      error: error.response?.data || {
        message: 'Error calling DashScope API',
        details: error.message
      }
    });
  }
});

// Stream voice call endpoint
router.post('/voice-call-stream', async (req, res) => {
  try {
    const { prompt, memory_id = null } = req.body;
    console.log('[DashScope] Received streaming request with prompt:', prompt);
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Build request data
    const requestData = {
      input: {
        prompt: prompt || 'Hello, how can I help you?'
      },
      parameters: {
        stream: true,
        incremental_output: true,
        response_format: {
          language: "en" // Force English response
        }
      },
      debug: {}
    };
    
    // Add memory_id if provided
    if (memory_id) {
      requestData.session_id = memory_id;
    }
    
    // Create request to DashScope
    const axiosConfig = {
      method: 'post',
      url: `https://dashscope.aliyuncs.com/api/v1/apps/${APP_ID}/completion`,
      data: requestData,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-DashScope-SSE': 'enable',
        'Accept-Language': 'en-US,en' // Add language header
      },
      responseType: 'stream'
    };
    
    console.log('[DashScope] Sending streaming request to API');
    const response = await axios(axiosConfig);
    
    // Pipe the stream directly to the client
    response.data.pipe(res);
    
    // Handle client disconnect
    req.on('close', () => {
      response.data.destroy();
    });
    
  } catch (error) {
    console.error('DashScope streaming error:', error.response?.data || error.message);
    
    // Send error as SSE event
    res.write(`data: ${JSON.stringify({
      error: error.response?.data || {
        message: 'Error streaming from DashScope API',
        details: error.message
      }
    })}\n\n`);
    
    res.end();
  }
});

// Image analysis endpoint using QVQ model
router.post('/image-analysis', async (req, res) => {
  try {
    const { messages } = req.body;
    console.log('[DashScope] Received image analysis request');
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Invalid request format. Messages array is required.'
        }
      });
    }
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Configure request for QVQ
    const axiosConfig = {
      method: 'post',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      data: {
        model: QVQ_MODEL,
        messages: messages,
        stream: true
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-DashScope-SSE': 'enable',
        'Accept-Language': 'en-US,en'
      },
      responseType: 'stream'
    };
    
    console.log('[DashScope] Sending image analysis request to QVQ API');
    const response = await axios(axiosConfig);
    
    // Stream processing logic to collect reasoning and content
    let reasoningContent = '';
    let answerContent = '';
    let isAnswering = false;
    
    response.data.on('data', chunk => {
      const text = chunk.toString().trim();
      
      if (text.startsWith('data:')) {
        try {
          // Extract the JSON data
          const jsonStr = text.replace(/^data: /, '').trim();
          
          if (jsonStr === '[DONE]') {
            return res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
          
          const data = JSON.parse(jsonStr);
          
          // Extract reasoning content
          if (data.choices && data.choices[0].delta && data.choices[0].delta.reasoning_content) {
            reasoningContent += data.choices[0].delta.reasoning_content;
            res.write(`data: ${JSON.stringify({ reasoning: data.choices[0].delta.reasoning_content })}\n\n`);
          }
          
          // Extract answer content
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            if (!isAnswering) {
              isAnswering = true;
              res.write(`data: ${JSON.stringify({ reasoning_complete: true })}\n\n`);
            }
            answerContent += data.choices[0].delta.content;
            res.write(`data: ${JSON.stringify({ content: data.choices[0].delta.content })}\n\n`);
          }
          
          // If usage information is available, send it
          if (data.usage) {
            res.write(`data: ${JSON.stringify({ usage: data.usage })}\n\n`);
          }
          
        } catch (error) {
          console.error('Error parsing QVQ stream:', error);
        }
      }
    });
    
    // Handle end of stream
    response.data.on('end', () => {
      res.write(`data: ${JSON.stringify({ 
        done: true,
        output: {
          text: answerContent,
          reasoning: reasoningContent
        }
      })}\n\n`);
      res.end();
    });
    
    // Handle stream errors
    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      res.write(`data: ${JSON.stringify({ 
        error: 'Stream error',
        message: error.message
      })}\n\n`);
      res.end();
    });
    
    // Handle client disconnect
    req.on('close', () => {
      response.data.destroy();
    });
    
  } catch (error) {
    console.error('DashScope QVQ error:', error.response?.data || error.message);
    
    // Send error as SSE event
    res.write(`data: ${JSON.stringify({
      error: error.response?.data || {
        message: 'Error processing image with QVQ model',
        details: error.message
      }
    })}\n\n`);
    
    res.end();
  }
});

// Start long-term memory session
router.post('/create-memory', async (req, res) => {
  try {
    console.log('[DashScope] Received create memory request');
    
    // Generate a random session ID locally
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    console.log('[DashScope] Created session ID:', sessionId);
    res.json({
      output: {
        memory_id: sessionId,
        session_id: sessionId,
        status: 'active'
      }
    });
  } catch (error) {
    console.error('DashScope create memory error:', error.response?.data || error.message);
    
    res.status(error.response?.status || 500).json({
      error: error.response?.data || {
        message: 'Error creating memory with DashScope API',
        details: error.message
      }
    });
  }
});

module.exports = router; 