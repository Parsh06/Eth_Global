const express = require('express');
const multer = require('multer');
const { body, param, query, validationResult } = require('express-validator');
const hederaService = require('../services/hederaService');
const filecoinService = require('../services/filecoinService');
const aiService = require('../services/aiService');
const graphService = require('../services/graphService');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'application/json'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, and JSON files are allowed.'));
    }
  }
});

// Submit challenge
router.post('/submit', authMiddleware, upload.single('proof'), [
  body('eventId').notEmpty().withMessage('Event ID is required'),
  body('challengeId').notEmpty().withMessage('Challenge ID is required'),
  body('challengeType').isIn(['photo', 'quiz', 'location', 'creative', 'skill']).withMessage('Invalid challenge type'),
  body('submissionData').notEmpty().withMessage('Submission data is required')
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

    const { eventId, challengeId, challengeType, submissionData } = req.body;
    const submitterAddress = req.user.address;
    const proofFile = req.file;

    // Parse submission data
    let parsedSubmissionData;
    try {
      parsedSubmissionData = JSON.parse(submissionData);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission data JSON'
      });
    }

    // Create submission object
    const submission = {
      id: `submission_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      eventId,
      challengeId,
      challengeType,
      submitter: submitterAddress,
      timestamp: new Date().toISOString(),
      content: parsedSubmissionData,
      metadata: {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        fileSize: proofFile?.size || 0,
        fileType: proofFile?.mimetype || null
      }
    };

    // Upload proof file to Filecoin if provided
    let proofHash = null;
    if (proofFile) {
      const proofUpload = await filecoinService.uploadFile(
        proofFile.buffer,
        proofFile.originalname,
        proofFile.mimetype
      );
      proofHash = proofUpload.ipfsHash;
      submission.proofFile = {
        hash: proofHash,
        url: proofUpload.url,
        size: proofFile.size,
        type: proofFile.mimetype
      };
    }

    // Upload submission data to Filecoin
    const submissionUpload = await filecoinService.uploadUserData(
      submission,
      `challenge-submission-${submission.id}`
    );

    // Submit challenge on-chain
    const onChainResult = await hederaService.submitChallenge(
      eventId,
      challengeId,
      submissionUpload.ipfsHash,
      submission,
      submitterAddress
    );

    // Store complete submission data
    const completeSubmission = {
      ...submission,
      submissionId: onChainResult.submissionId,
      proofHash: submissionUpload.ipfsHash,
      txHash: onChainResult.txHash,
      status: 'pending_verification'
    };

    logger.info(`Challenge submitted: ${completeSubmission.id} (On-chain: ${onChainResult.submissionId})`);

    // Trigger AI verification asynchronously
    setImmediate(async () => {
      try {
        await processAIVerification(completeSubmission);
      } catch (error) {
        logger.error('AI verification failed:', error);
      }
    });

    res.status(201).json({
      success: true,
      submission: {
        id: completeSubmission.id,
        submissionId: onChainResult.submissionId,
        eventId,
        challengeId,
        submitter: submitterAddress,
        timestamp: completeSubmission.timestamp,
        txHash: onChainResult.txHash,
        status: 'pending_verification'
      }
    });
  } catch (error) {
    logger.error('Failed to submit challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit challenge',
      error: error.message
    });
  }
});

// Get challenge submissions for an event/challenge
router.get('/', [
  query('eventId').optional().notEmpty().withMessage('Event ID cannot be empty'),
  query('challengeId').optional().notEmpty().withMessage('Challenge ID cannot be empty'),
  query('submitter').optional().isEthereumAddress().withMessage('Valid submitter address required'),
  query('status').optional().isIn(['pending_verification', 'verified', 'rejected']).withMessage('Invalid status'),
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

    const { eventId, challengeId, submitter, status, page = 1, limit = 10 } = req.query;

    // Query submissions from The Graph
    const graphQuery = `
      query GetChallengeSubmissions($first: Int, $skip: Int, $eventId: String, $challengeId: String, $submitter: String, $status: String) {
        challengeSubmissions(
          first: $first,
          skip: $skip,
          where: {
            ${eventId ? `eventId: $eventId` : ''}
            ${challengeId ? `challengeId: $challengeId` : ''}
            ${submitter ? `submitter: $submitter` : ''}
            ${status ? `status: $status` : ''}
          },
          orderBy: timestamp,
          orderDirection: desc
        ) {
          id
          submissionId
          eventId
          challengeId
          submitter
          proofHash
          verified
          score
          timestamp
          txHash
        }
      }
    `;

    const variables = {
      first: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
      eventId,
      challengeId,
      submitter: submitter?.toLowerCase(),
      status
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const submissions = graphResult.data.challengeSubmissions;

    // Enrich with detailed data from Filecoin
    const submissionsWithDetails = await Promise.all(
      submissions.map(async (submission) => {
        try {
          const detailedData = await filecoinService.getUserData(submission.proofHash);
          return {
            ...submission,
            details: detailedData,
            verification: detailedData.verification || null
          };
        } catch (error) {
          logger.error(`Failed to fetch details for submission ${submission.id}:`, error);
          return submission;
        }
      })
    );

    res.json({
      success: true,
      submissions: submissionsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: submissionsWithDetails.length
      }
    });
  } catch (error) {
    logger.error('Failed to get challenge submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve challenge submissions'
    });
  }
});

// Get specific submission details
router.get('/:submissionId', [
  param('submissionId').notEmpty().withMessage('Submission ID is required')
], async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Check if submissionId is on-chain ID or off-chain ID
    let submissionData;

    if (/^\d+$/.test(submissionId)) {
      // On-chain submission ID
      submissionData = await hederaService.getChallengeSubmission(submissionId);
      
      // Get detailed data from Filecoin
      const detailedData = await filecoinService.getUserData(submissionData.proofHash);
      submissionData = { ...submissionData, ...detailedData };
    } else {
      // Off-chain ID - query from The Graph
      const graphQuery = `
        query GetSubmission($submissionId: String!) {
          challengeSubmission(id: $submissionId) {
            id
            submissionId
            eventId
            challengeId
            submitter
            proofHash
            verified
            score
            timestamp
            txHash
          }
        }
      `;

      const graphResult = await graphService.query(graphQuery, { submissionId });
      if (!graphResult.data.challengeSubmission) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      }

      const graphData = graphResult.data.challengeSubmission;
      const detailedData = await filecoinService.getUserData(graphData.proofHash);
      submissionData = { ...graphData, ...detailedData };
    }

    res.json({
      success: true,
      submission: submissionData
    });
  } catch (error) {
    logger.error('Failed to get submission details:', error);
    res.status(404).json({
      success: false,
      message: 'Submission not found'
    });
  }
});

// Manually verify submission (admin only)
router.post('/:submissionId/verify', authMiddleware, [
  param('submissionId').isNumeric().withMessage('Submission ID must be numeric'),
  body('isValid').isBoolean().withMessage('isValid must be a boolean'),
  body('score').isInt({ min: 0, max: 100 }).withMessage('Score must be between 0 and 100'),
  body('reasoning').optional().notEmpty().withMessage('Reasoning cannot be empty')
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

    const { submissionId } = req.params;
    const { isValid, score, reasoning } = req.body;
    const verifierAddress = req.user.address;

    // Verify challenge on-chain
    const result = await hederaService.verifyChallenge(submissionId, isValid, score);

    // Update verification data in Filecoin
    const submissionData = await hederaService.getChallengeSubmission(submissionId);
    const detailedData = await filecoinService.getUserData(submissionData.proofHash);
    
    const updatedData = {
      ...detailedData,
      verification: {
        isValid,
        score,
        reasoning: reasoning || 'Manual verification',
        verifiedBy: verifierAddress,
        verifiedAt: new Date().toISOString(),
        method: 'manual'
      }
    };

    await filecoinService.uploadUserData(updatedData, `challenge-submission-${detailedData.id}-verified`);

    logger.info(`Submission ${submissionId} manually verified by ${verifierAddress}: ${isValid ? 'Valid' : 'Invalid'} (Score: ${score})`);

    res.json({
      success: true,
      verification: {
        submissionId,
        isValid,
        score,
        reasoning,
        verifiedBy: verifierAddress,
        verifiedAt: new Date().toISOString(),
        txHash: result.txHash
      }
    });
  } catch (error) {
    logger.error('Failed to verify submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify submission',
      error: error.message
    });
  }
});

// Get challenge leaderboard
router.get('/:eventId/:challengeId/leaderboard', [
  param('eventId').notEmpty().withMessage('Event ID is required'),
  param('challengeId').notEmpty().withMessage('Challenge ID is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], async (req, res) => {
  try {
    const { eventId, challengeId } = req.params;
    const { limit = 10 } = req.query;

    // Query verified submissions for the challenge
    const graphQuery = `
      query GetChallengeLeaderboard($eventId: String!, $challengeId: String!, $first: Int) {
        challengeSubmissions(
          first: $first,
          where: {
            eventId: $eventId,
            challengeId: $challengeId,
            verified: true
          },
          orderBy: score,
          orderDirection: desc
        ) {
          id
          submissionId
          submitter
          score
          timestamp
          verified
        }
      }
    `;

    const variables = {
      eventId,
      challengeId,
      first: parseInt(limit)
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const submissions = graphResult.data.challengeSubmissions;

    const leaderboard = submissions.map((submission, index) => ({
      rank: index + 1,
      submitter: submission.submitter,
      score: submission.score,
      submissionId: submission.submissionId,
      timestamp: submission.timestamp
    }));

    res.json({
      success: true,
      leaderboard,
      challenge: {
        eventId,
        challengeId,
        totalSubmissions: submissions.length
      }
    });
  } catch (error) {
    logger.error('Failed to get challenge leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve challenge leaderboard'
    });
  }
});

// Determine winners for a challenge
router.post('/:eventId/:challengeId/determine-winners', authMiddleware, [
  param('eventId').notEmpty().withMessage('Event ID is required'),
  param('challengeId').notEmpty().withMessage('Challenge ID is required'),
  body('maxWinners').optional().isInt({ min: 1, max: 10 }).withMessage('Max winners must be between 1 and 10')
], async (req, res) => {
  try {
    const { eventId, challengeId } = req.params;
    const { maxWinners = 3 } = req.body;
    const adminAddress = req.user.address;

    // Get all verified submissions for the challenge
    const graphQuery = `
      query GetChallengeSubmissions($eventId: String!, $challengeId: String!) {
        challengeSubmissions(
          where: {
            eventId: $eventId,
            challengeId: $challengeId,
            verified: true
          },
          orderBy: timestamp,
          orderDirection: asc
        ) {
          id
          submissionId
          submitter
          score
          timestamp
          proofHash
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { eventId, challengeId });
    const submissions = graphResult.data.challengeSubmissions;

    if (submissions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No verified submissions found for this challenge'
      });
    }

    // Enrich submissions with verification data
    const enrichedSubmissions = await Promise.all(
      submissions.map(async (submission) => {
        try {
          const detailedData = await filecoinService.getUserData(submission.proofHash);
          return {
            ...submission,
            verification: detailedData.verification
          };
        } catch (error) {
          return submission;
        }
      })
    );

    // Use AI service to determine winners
    const winnersResult = await aiService.determineWinners(enrichedSubmissions, maxWinners);

    // Store winners result
    const winnersData = {
      eventId,
      challengeId,
      winners: winnersResult.winners,
      totalSubmissions: winnersResult.totalSubmissions,
      validSubmissions: winnersResult.validSubmissions,
      determinedBy: adminAddress,
      determinedAt: new Date().toISOString(),
      method: 'ai_assisted'
    };

    // Upload winners data to Filecoin
    const winnersUpload = await filecoinService.uploadUserData(
      winnersData,
      `winners-${eventId}-${challengeId}`
    );

    logger.info(`Winners determined for challenge ${challengeId}: ${winnersResult.winners.length} winners from ${winnersResult.totalSubmissions} submissions`);

    res.json({
      success: true,
      winners: winnersResult.winners,
      summary: {
        eventId,
        challengeId,
        totalSubmissions: winnersResult.totalSubmissions,
        validSubmissions: winnersResult.validSubmissions,
        winnersCount: winnersResult.winners.length,
        determinedAt: winnersData.determinedAt,
        proofHash: winnersUpload.ipfsHash
      }
    });
  } catch (error) {
    logger.error('Failed to determine winners:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to determine winners',
      error: error.message
    });
  }
});

// AI verification processing function
async function processAIVerification(submission) {
  try {
    // Get challenge data from event
    let challengeData;
    try {
      // In a real implementation, you'd fetch challenge details from event data
      challengeData = {
        title: `Challenge ${submission.challengeId}`,
        description: 'Challenge description',
        requirements: {},
        scoringCriteria: {}
      };
    } catch (error) {
      logger.error('Failed to get challenge data:', error);
      return;
    }

    // Run AI verification
    const verification = await aiService.verifyChallenge(
      challengeData,
      submission,
      submission.challengeType
    );

    // Update submission with verification
    const updatedSubmission = {
      ...submission,
      verification,
      status: verification.isValid ? 'verified' : 'rejected'
    };

    // Upload updated data to Filecoin
    await filecoinService.uploadUserData(
      updatedSubmission,
      `challenge-submission-${submission.id}-ai-verified`
    );

    // Update on-chain verification
    await hederaService.verifyChallenge(
      submission.submissionId,
      verification.isValid,
      verification.score
    );

    logger.info(`AI verification completed for submission ${submission.id}: ${verification.isValid ? 'Valid' : 'Invalid'} (Score: ${verification.score})`);
  } catch (error) {
    logger.error('AI verification process failed:', error);
  }
}

module.exports = router; 