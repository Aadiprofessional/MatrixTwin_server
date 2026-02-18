const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// HHD Smart Lock API Configuration
const HHD_CONFIG = {
  baseUrl: 'http://api.hhdlink.top/hhdApi/public/api',
  deviceCode: '019072654811', // Active device from live API response
  deviceName: 'HHD_SmartLock_001',
  credentials: {
    accessKeyId: 'r7eD1NS7mJW3GNS3',
    accessSecret: 'q6hr8k24Zp78jlFDrSO5qrNgvexql628'
  }
};

// Helper function to make requests to HHD API
const makeHHDRequest = async (endpoint, data = null, method = 'POST') => {
  const fetch = (await import('node-fetch')).default;
  
  const url = `${HHD_CONFIG.baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'accessKeyId': HHD_CONFIG.credentials.accessKeyId,
    'accessSecret': HHD_CONFIG.credentials.accessSecret
  };

  const options = {
    method: method,
    headers,
    ...(data && { body: JSON.stringify(data) })
  };

  console.log(`[HHD API] Making ${method} request to: ${url}`);
  if (data) {
    console.log(`[HHD API] Request body:`, JSON.stringify(data, null, 2));
  }
  
  try {
    const response = await fetch(url, options);
    const responseData = await response.json();
    
    console.log(`[HHD API] Response status: ${response.status}`);
    console.log(`[HHD API] Response data:`, responseData);
    
    return {
      success: response.ok && responseData.returnCode === "200",
      status: response.status,
      data: responseData,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[HHD API] Error making request to ${url}:`, error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// ================================
// DEVICE INFO APIs
// ================================

/**
 * @route   GET /api/smartlock/device-info
 * @desc    Query basic device information
 * @access  Private
 */
router.get('/device-info', auth, async (req, res) => {
  try {
    const result = await makeHHDRequest('/iotDevice/queryDeviceDetail', {
      deviceCode: HHD_CONFIG.deviceCode
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get device info',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in device-info:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/device-list
 * @desc    Query device list with pagination
 * @access  Private
 */
router.post('/device-list', auth, async (req, res) => {
  try {
    const { curPage = 1, pageSize = 10, name, deviceCode, companyId, online } = req.body;
    
    const result = await makeHHDRequest('/iotDevice/page', {
      curPage,
      pageSize,
      ...(name && { name }),
      ...(deviceCode && { deviceCode }),
      ...(companyId && { companyId }),
      ...(online !== undefined && { online })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get device list',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in device-list:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// DEVICE DATA APIs
// ================================

/**
 * @route   POST /api/smartlock/latest-data
 * @desc    Get latest data by device codes
 * @access  Private
 */
router.post('/latest-data', auth, async (req, res) => {
  try {
    const { deviceCodes = [HHD_CONFIG.deviceCode] } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceData/getNewDataByDeviceCodes', deviceCodes);

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get latest data',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in latest-data:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/history-data
 * @desc    Get historical device data
 * @access  Private
 */
router.post('/history-data', auth, async (req, res) => {
  try {
    const { 
      curPage = 1, 
      pageSize = 10, 
      deviceCodes = [HHD_CONFIG.deviceCode],
      dataType = 0,
      gpsStartTime,
      gpsEndTime
    } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceData/getHistoryData', {
      curPage,
      pageSize,
      deviceCodes,
      dataType,
      ...(gpsStartTime && { gpsStartTime }),
      ...(gpsEndTime && { gpsEndTime })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get history data',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in history-data:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/track-list
 * @desc    Get device track list
 * @access  Private
 */
router.post('/track-list', auth, async (req, res) => {
  try {
    const { 
      curPage = 1, 
      pageSize = 10, 
      deviceCodes = [HHD_CONFIG.deviceCode],
      gpsStartTime,
      gpsEndTime
    } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceData/getTrackList', {
      curPage,
      pageSize,
      deviceCodes,
      ...(gpsStartTime && { gpsStartTime }),
      ...(gpsEndTime && { gpsEndTime })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get track list',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in track-list:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/event-list
 * @desc    Get device event list
 * @access  Private
 */
router.post('/event-list', auth, async (req, res) => {
  try {
    const { 
      curPage = 1, 
      pageSize = 10, 
      deviceCodes = [HHD_CONFIG.deviceCode],
      gpsStartTime,
      gpsEndTime,
      eventType
    } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceData/getEventList', {
      curPage,
      pageSize,
      deviceCodes,
      ...(gpsStartTime && { gpsStartTime }),
      ...(gpsEndTime && { gpsEndTime }),
      ...(eventType !== undefined && { eventType })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get event list',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in event-list:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// LOCK/UNLOCK CONTROL APIs
// ================================

/**
 * @route   POST /api/smartlock/unlock
 * @desc    Unlock the smart lock (Unseal)
 * @access  Private
 */
router.post('/unlock', auth, async (req, res) => {
  try {
    const { deviceCode = HHD_CONFIG.deviceCode, userName = 'API_User' } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/sealAndUnsealCmd', {
      deviceCode,
      type: "00", // 00 = Unseal (Unlock)
      userName
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to unlock device',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      action: 'unlock',
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in unlock:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/lock
 * @desc    Lock the smart lock (Seal)
 * @access  Private
 */
router.post('/lock', auth, async (req, res) => {
  try {
    const { deviceCode = HHD_CONFIG.deviceCode, userName = 'API_User' } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/sealAndUnsealCmd', {
      deviceCode,
      type: "01", // 01 = Seal (Lock)
      userName
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to lock device',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      action: 'lock',
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in lock:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// DEVICE PARAMETER APIs
// ================================

/**
 * @route   POST /api/smartlock/set-parameters
 * @desc    Set device parameters
 * @access  Private
 */
router.post('/set-parameters', auth, async (req, res) => {
  try {
    const { deviceCode = HHD_CONFIG.deviceCode, parameters } = req.body;
    
    if (!parameters) {
      return res.status(400).json({
        error: 'Parameters are required'
      });
    }
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/setDeviceParameter', {
      deviceCode,
      parameters
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to set device parameters',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in set-parameters:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/smartlock/get-parameters
 * @desc    Get device parameters
 * @access  Private
 */
router.post('/get-parameters', auth, async (req, res) => {
  try {
    const { deviceCode = HHD_CONFIG.deviceCode } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/getDeviceParameter', {
      deviceCode
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get device parameters',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in get-parameters:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// NFC CARD MANAGEMENT APIs
// ================================

/**
 * @route   POST /api/smartlock/set-nfc-card
 * @desc    Set NFC card for device
 * @access  Private
 */
router.post('/set-nfc-card', auth, async (req, res) => {
  try {
    const { deviceCode = HHD_CONFIG.deviceCode, nfcData } = req.body;
    
    if (!nfcData) {
      return res.status(400).json({
        error: 'NFC data is required'
      });
    }
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/setDeviceNfcCard', {
      deviceCode,
      ...nfcData
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to set NFC card',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in set-nfc-card:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/smartlock/get-nfc-card/:deviceCode
 * @desc    Get NFC card information
 * @access  Private
 */
router.get('/get-nfc-card/:deviceCode?', auth, async (req, res) => {
  try {
    const deviceCode = req.params.deviceCode || HHD_CONFIG.deviceCode;
    const { blockNum = 0, type = 0 } = req.query;
    
    const result = await makeHHDRequest(`/iotDeviceSendCmd/getDeviceNfcCard/${deviceCode}?blockNum=${blockNum}&type=${type}`, null, 'GET');

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get NFC card info',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in get-nfc-card:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   DELETE /api/smartlock/delete-nfc-card/:deviceCode
 * @desc    Delete NFC card from device
 * @access  Private
 */
router.delete('/delete-nfc-card/:deviceCode?', auth, async (req, res) => {
  try {
    const deviceCode = req.params.deviceCode || HHD_CONFIG.deviceCode;
    const { blockNum = 0, type = 0 } = req.query;
    
    const result = await makeHHDRequest(`/iotDeviceSendCmd/delDeviceNfcCard/${deviceCode}?blockNum=${blockNum}&type=${type}`, null, 'GET');

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to delete NFC card',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in delete-nfc-card:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// DYNAMIC PASSWORD API
// ================================

/**
 * @route   GET /api/smartlock/dynamic-password/:deviceCode?
 * @desc    Get dynamic password for device
 * @access  Private
 */
router.get('/dynamic-password/:deviceCode?', auth, async (req, res) => {
  try {
    const deviceCode = req.params.deviceCode || HHD_CONFIG.deviceCode;
    
    const result = await makeHHDRequest(`/iotDeviceSendCmd/getDynamicPassword/${deviceCode}`, null, 'GET');

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get dynamic password',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in dynamic-password:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// COMMAND LOG API
// ================================

/**
 * @route   POST /api/smartlock/command-log
 * @desc    Get command log records
 * @access  Private
 */
router.post('/command-log', auth, async (req, res) => {
  try {
    const { 
      curPage = 1, 
      pageSize = 10, 
      deviceCode = HHD_CONFIG.deviceCode,
      startTime,
      endTime
    } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/getCmdLogRecord', {
      curPage,
      pageSize,
      deviceCode,
      ...(startTime && { startTime }),
      ...(endTime && { endTime })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get command log',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in command-log:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// FENCE MANAGEMENT APIs
// ================================

/**
 * @route   POST /api/smartlock/fence-page
 * @desc    Get device fence page list
 * @access  Private
 */
router.post('/fence-page', auth, async (req, res) => {
  try {
    const { 
      deviceCode = HHD_CONFIG.deviceCode,
      sendStatus,
      beginTime,
      endTime,
      curPage = 1,
      pageSize = 10
    } = req.body;
    
    const result = await makeHHDRequest('/iotDeviceSendCmd/getDeviceFencePage', {
      deviceCode,
      curPage,
      pageSize,
      ...(sendStatus !== undefined && { sendStatus }),
      ...(beginTime && { beginTime }),
      ...(endTime && { endTime })
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to get fence page',
        details: result.error || result.data
      });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[HHD API] Error in fence-page:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ================================
// UTILITY ENDPOINTS
// ================================

/**
 * @route   GET /api/smartlock/status
 * @desc    Get smart lock status summary
 * @access  Private
 */
router.get('/status', auth, async (req, res) => {
  try {
    // Get device info
    const deviceInfoResult = await makeHHDRequest('/iotDevice/queryDeviceDetail', {
      deviceCode: HHD_CONFIG.deviceCode
    });

    // Get latest data
    const latestDataResult = await makeHHDRequest('/iotDeviceData/getNewDataByDeviceCodes', [HHD_CONFIG.deviceCode]);

    const statusData = {
      deviceCode: HHD_CONFIG.deviceCode,
      deviceName: HHD_CONFIG.deviceName,
      deviceInfo: deviceInfoResult.success ? deviceInfoResult.data : null,
      latestData: latestDataResult.success ? latestDataResult.data : null,
      apiStatus: {
        deviceInfo: deviceInfoResult.success,
        latestData: latestDataResult.success
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: statusData
    });
  } catch (error) {
    console.error('[HHD API] Error in status:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/smartlock/config
 * @desc    Get smart lock configuration (non-sensitive)
 * @access  Private
 */
router.get('/config', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        deviceCode: HHD_CONFIG.deviceCode,
        deviceName: HHD_CONFIG.deviceName,
        baseUrl: HHD_CONFIG.baseUrl,
        apiVersion: '1.0',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[HHD API] Error in config:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/smartlock/health
 * @desc    Check API health
 * @access  Private
 */
router.get('/health', auth, async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test API connectivity
    const testResult = await makeHHDRequest('/iotDevice/queryDeviceDetail', {
      deviceCode: HHD_CONFIG.deviceCode
    });
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        status: testResult.success ? 'healthy' : 'degraded',
        responseTime: `${responseTime}ms`,
        apiAccessible: testResult.success,
        lastError: testResult.error || null,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[HHD API] Error in health:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

module.exports = router; 