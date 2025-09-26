const express = require('express');
const multer = require('multer');
const { body, param, query, validationResult } = require('express-validator');
const filecoinService = require('../services/filecoinService');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'application/json', 'text/plain',
      'application/pdf', 'application/zip'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

// Upload file to Filecoin
router.post('/upload', authMiddleware, upload.single('file'), [
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('category').optional().isIn(['event', 'challenge', 'proof', 'metadata', 'other']).withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const { description, category = 'other' } = req.body;
    const uploaderAddress = req.user.address;

    // Create file metadata
    const fileMetadata = {
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: uploaderAddress,
      uploadedAt: new Date().toISOString(),
      description: description || '',
      category
    };

    // Upload to Filecoin
    const uploadResult = await filecoinService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      fileMetadata
    );

    logger.info(`File uploaded to Filecoin: ${req.file.originalname} (${uploadResult.ipfsHash})`);

    res.json({
      success: true,
      file: {
        ipfsHash: uploadResult.ipfsHash,
        url: uploadResult.url,
        size: uploadResult.size,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        category,
        uploadedAt: fileMetadata.uploadedAt,
        uploadedBy: uploaderAddress
      }
    });
  } catch (error) {
    logger.error('Failed to upload file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
});

// Upload JSON data to Filecoin
router.post('/upload-data', authMiddleware, [
  body('data').isObject().withMessage('Data must be a valid JSON object'),
  body('name').notEmpty().withMessage('Name is required'),
  body('category').optional().isIn(['event', 'challenge', 'proof', 'metadata', 'other']).withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { data, name, category = 'other' } = req.body;
    const uploaderAddress = req.user.address;

    // Add metadata to data
    const enrichedData = {
      ...data,
      metadata: {
        name,
        category,
        uploadedBy: uploaderAddress,
        uploadedAt: new Date().toISOString(),
        version: '1.0'
      }
    };

    // Upload to Filecoin
    const uploadResult = await filecoinService.uploadUserData(enrichedData, name);

    logger.info(`Data uploaded to Filecoin: ${name} (${uploadResult.ipfsHash})`);

    res.json({
      success: true,
      data: {
        ipfsHash: uploadResult.ipfsHash,
        url: uploadResult.url,
        name,
        category,
        uploadedAt: enrichedData.metadata.uploadedAt,
        uploadedBy: uploaderAddress
      }
    });
  } catch (error) {
    logger.error('Failed to upload data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload data',
      error: error.message
    });
  }
});

// Get file/data from Filecoin by IPFS hash
router.get('/retrieve/:ipfsHash', 
  param('ipfsHash').notEmpty().withMessage('IPFS hash is required')
], async (req, res) => {
  try {
    const { ipfsHash } = req.params;

    // Retrieve data from Filecoin
    const data = await filecoinService.getUserData(ipfsHash);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data not found'
      });
    }

    res.json({
      success: true,
      data,
      ipfsHash,
      retrievedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to retrieve data for hash ${req.params.ipfsHash}:`, error);
    res.status(404).json({
      success: false,
      message: 'Failed to retrieve data',
      error: error.message
    });
  }
});

// Get file content directly (for images, videos, etc.)
router.get('/file/:ipfsHash', 
  param('ipfsHash').notEmpty().withMessage('IPFS hash is required')
], async (req, res) => {
  try {
    const { ipfsHash } = req.params;

    // Get file from Filecoin
    const fileData = await filecoinService.getFile(ipfsHash);

    if (!fileData) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Set appropriate headers
    if (fileData.mimeType) {
      res.set('Content-Type', fileData.mimeType);
    }
    
    if (fileData.originalName) {
      res.set('Content-Disposition', `inline; filename="${fileData.originalName}"`);
    }

    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Send file buffer
    res.send(fileData.buffer);
  } catch (error) {
    logger.error(`Failed to get file for hash ${req.params.ipfsHash}:`, error);
    res.status(404).json({
      success: false,
      message: 'File not found'
    });
  }
});

// Get user's upload history
router.get('/uploads', authMiddleware, [
  query('category').optional().isIn(['event', 'challenge', 'proof', 'metadata', 'other']).withMessage('Invalid category'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { category, page = 1, limit = 10 } = req.query;
    const userAddress = req.user.address;

    // Get user's uploads (this would typically be stored in a database or indexed)
    // For MVP, we'll return a simple response
    const uploads = await filecoinService.getUserUploads(userAddress, {
      category,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      uploads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: uploads.length
      }
    });
  } catch (error) {
    logger.error('Failed to get user uploads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve upload history'
    });
  }
});

// Pin content to ensure availability
router.post('/pin/:ipfsHash', authMiddleware, [
  param('ipfsHash').notEmpty().withMessage('IPFS hash is required')
], async (req, res) => {
  try {
    const { ipfsHash } = req.params;
    const userAddress = req.user.address;

    // Pin content on Filecoin network
    const pinResult = await filecoinService.pinContent(ipfsHash);

    logger.info(`Content pinned by ${userAddress}: ${ipfsHash}`);

    res.json({
      success: true,
      pin: {
        ipfsHash,
        pinned: true,
        pinnedBy: userAddress,
        pinnedAt: new Date().toISOString(),
        pinId: pinResult.pinId
      }
    });
  } catch (error) {
    logger.error('Failed to pin content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pin content',
      error: error.message
    });
  }
});

// Get storage statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userAddress = req.user.address;

    // Get user's storage statistics
    const stats = await filecoinService.getUserStorageStats(userAddress);

    res.json({
      success: true,
      stats: {
        totalUploads: stats.totalUploads || 0,
        totalSize: stats.totalSize || 0,
        categoryCounts: stats.categoryCounts || {},
        lastUpload: stats.lastUpload || null,
        storageUsed: stats.storageUsed || '0 MB'
      }
    });
  } catch (error) {
    logger.error('Failed to get storage stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve storage statistics'
    });
  }
});

// Batch upload multiple files
router.post('/upload-batch', authMiddleware, upload.array('files', 10), [
  body('descriptions').optional().isArray().withMessage('Descriptions must be an array'),
  body('category').optional().isIn(['event', 'challenge', 'proof', 'metadata', 'other']).withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const { descriptions = [], category = 'other' } = req.body;
    const uploaderAddress = req.user.address;

    // Upload all files
    const uploadResults = await Promise.all(
      req.files.map(async (file, index) => {
        try {
          const fileMetadata = {
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            uploadedBy: uploaderAddress,
            uploadedAt: new Date().toISOString(),
            description: descriptions[index] || '',
            category
          };

          const result = await filecoinService.uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            fileMetadata
          );

          return {
            success: true,
            ipfsHash: result.ipfsHash,
            url: result.url,
            originalName: file.originalname,
            size: file.size
          };
        } catch (error) {
          return {
            success: false,
            originalName: file.originalname,
            error: error.message
          };
        }
      })
    );

    const successfulUploads = uploadResults.filter(result => result.success);
    const failedUploads = uploadResults.filter(result => !result.success);

    logger.info(`Batch upload completed: ${successfulUploads.length} successful, ${failedUploads.length} failed`);

    res.json({
      success: true,
      results: {
        successful: successfulUploads,
        failed: failedUploads,
        totalFiles: req.files.length,
        successCount: successfulUploads.length,
        failureCount: failedUploads.length
      }
    });
  } catch (error) {
    logger.error('Failed to upload batch files:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload batch files',
      error: error.message
    });
  }
});

// Search uploaded content
router.get('/search', authMiddleware, [
  query('query').notEmpty().withMessage('Search query is required'),
  query('category').optional().isIn(['event', 'challenge', 'proof', 'metadata', 'other']).withMessage('Invalid category'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { query: searchQuery, category, page = 1, limit = 10 } = req.query;
    const userAddress = req.user.address;

    // Search user's content
    const searchResults = await filecoinService.searchUserContent(userAddress, {
      query: searchQuery,
      category,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      results: searchResults,
      searchQuery,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: searchResults.length
      }
    });
  } catch (error) {
    logger.error('Failed to search content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search content'
    });
  }
});

module.exports = router; 