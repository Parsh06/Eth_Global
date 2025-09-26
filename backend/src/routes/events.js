const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const filecoinService = require('../services/filecoinService');
const hederaService = require('../services/hederaService');
const graphService = require('../services/graphService');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Create new event
router.post('/', authMiddleware, [
  body('name').notEmpty().withMessage('Event name is required'),
  body('description').notEmpty().withMessage('Event description is required'),
  body('location').isObject().withMessage('Event location is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('stalls').isArray().withMessage('Stalls array is required')
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

    const { name, description, location, startDate, endDate, stalls, challenges } = req.body;
    const creatorAddress = req.user.address;

    // Validate event dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    // Create event data structure
    const eventData = {
      id: `event_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      name,
      description,
      location,
      startDate,
      endDate,
      stalls: stalls.map(stall => ({
        id: stall.id || `stall_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        name: stall.name,
        description: stall.description,
        coordinates: {
          latitude: stall.coordinates.latitude,
          longitude: stall.coordinates.longitude
        },
        category: stall.category || 'general',
        challenges: stall.challenges || []
      })),
      challenges: challenges || [],
      creator: creatorAddress,
      createdAt: new Date().toISOString(),
      status: 'active'
    };

    // Upload event data to Filecoin
    const filecoinResult = await filecoinService.uploadEventData(eventData);
    if (!filecoinResult.success) {
      throw new Error('Failed to upload event data to Filecoin');
    }

    // Create event on-chain
    const hederaResult = await hederaService.createEvent({
      name: eventData.name,
      ipfsHash: filecoinResult.ipfsHash,
      startDate: eventData.startDate,
      endDate: eventData.endDate
    });

    // Store additional metadata
    const fullEventData = {
      ...eventData,
      onChainId: hederaResult.eventId,
      ipfsHash: filecoinResult.ipfsHash,
      txHash: hederaResult.txHash,
      filecoinUrl: filecoinResult.url
    };

    logger.info(`Event created: ${eventData.id} (On-chain ID: ${hederaResult.eventId})`);

    res.status(201).json({
      success: true,
      event: fullEventData,
      blockchain: {
        eventId: hederaResult.eventId,
        txHash: hederaResult.txHash
      },
      storage: {
        ipfsHash: filecoinResult.ipfsHash,
        url: filecoinResult.url
      }
    });
  } catch (error) {
    logger.error('Failed to create event:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create event',
      error: error.message
    });
  }
});

// Get all events with pagination
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('status').optional().isIn(['active', 'upcoming', 'ended']).withMessage('Invalid status'),
  query('location').optional().notEmpty().withMessage('Location cannot be empty')
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

    const { page = 1, limit = 10, status, location } = req.query;

    // Query events from The Graph
    const graphQuery = `
      query GetEvents($first: Int, $skip: Int, $status: String, $location: String) {
        events(
          first: $first,
          skip: $skip,
          where: { 
            ${status ? `status: $status` : ''}
            ${location ? `location_contains: $location` : ''}
          },
          orderBy: createdAt,
          orderDirection: desc
        ) {
          id
          onChainId
          name
          ipfsHash
          startTime
          endTime
          active
          creator
          createdAt
        }
      }
    `;

    const variables = {
      first: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
      status,
      location
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const events = graphResult.data.events;

    // Fetch detailed data from Filecoin for each event
    const eventsWithDetails = await Promise.all(
      events.map(async (event) => {
        try {
          const eventDetails = await filecoinService.getEventData(event.ipfsHash);
          return {
            ...event,
            ...eventDetails,
            onChainData: {
              id: event.onChainId,
              active: event.active,
              startTime: event.startTime,
              endTime: event.endTime
            }
          };
        } catch (error) {
          logger.error(`Failed to fetch details for event ${event.id}:`, error);
          return event; // Return basic data if Filecoin fetch fails
        }
      })
    );

    res.json({
      success: true,
      events: eventsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: eventsWithDetails.length
      }
    });
  } catch (error) {
    logger.error('Failed to get events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve events'
    });
  }
});

// Get specific event by ID
router.get('/:eventId', [
  param('eventId').notEmpty().withMessage('Event ID is required')
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

    const { eventId } = req.params;

    // Check if eventId is an on-chain ID (numeric) or off-chain ID
    let event;
    
    if (/^\d+$/.test(eventId)) {
      // On-chain ID - get from Hedera
      const onChainEvent = await hederaService.getEvent(eventId);
      
      // Get full data from Filecoin
      event = await filecoinService.getEventData(onChainEvent.ipfsHash);
      event.onChainData = {
        id: eventId,
        ...onChainEvent
      };
    } else {
      // Off-chain ID - query from The Graph
      const graphQuery = `
        query GetEvent($eventId: String!) {
          event(id: $eventId) {
            id
            onChainId
            name
            ipfsHash
            startTime
            endTime
            active
            creator
            createdAt
          }
        }
      `;

      const graphResult = await graphService.query(graphQuery, { eventId });
      
      if (!graphResult.data.event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }

      const graphEvent = graphResult.data.event;
      event = await filecoinService.getEventData(graphEvent.ipfsHash);
      event.onChainData = graphEvent;
    }

    res.json({
      success: true,
      event
    });
  } catch (error) {
    logger.error('Failed to get event:', error);
    res.status(404).json({
      success: false,
      message: 'Event not found or failed to retrieve event data'
    });
  }
});

// Get event stalls with coordinates
router.get('/:eventId/stalls', [
  param('eventId').notEmpty().withMessage('Event ID is required')
], async (req, res) => {
  try {
    const { eventId } = req.params;

    // Get event data (contains stalls)
    let eventData;
    
    if (/^\d+$/.test(eventId)) {
      const onChainEvent = await hederaService.getEvent(eventId);
      eventData = await filecoinService.getEventData(onChainEvent.ipfsHash);
    } else {
      const graphQuery = `
        query GetEvent($eventId: String!) {
          event(id: $eventId) {
            ipfsHash
          }
        }
      `;
      const graphResult = await graphService.query(graphQuery, { eventId });
      if (!graphResult.data.event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }
      eventData = await filecoinService.getEventData(graphResult.data.event.ipfsHash);
    }

    const stallsWithChallenges = eventData.stalls.map(stall => ({
      id: stall.id,
      name: stall.name,
      description: stall.description,
      coordinates: stall.coordinates,
      category: stall.category,
      challenges: stall.challenges,
      challengeCount: stall.challenges?.length || 0
    }));

    res.json({
      success: true,
      stalls: stallsWithChallenges,
      totalStalls: stallsWithChallenges.length,
      event: {
        id: eventData.id,
        name: eventData.name,
        location: eventData.location
      }
    });
  } catch (error) {
    logger.error('Failed to get event stalls:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve event stalls'
    });
  }
});

// Check into event
router.post('/:eventId/checkin', authMiddleware, [
  param('eventId').notEmpty().withMessage('Event ID is required'),
  body('location').isObject().withMessage('Location is required'),
  body('location.latitude').isFloat().withMessage('Valid latitude is required'),
  body('location.longitude').isFloat().withMessage('Valid longitude is required')
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

    const { eventId } = req.params;
    const { location } = req.body;
    const userAddress = req.user.address;

    // Get event data to verify location
    let eventData;
    let onChainEventId;

    if (/^\d+$/.test(eventId)) {
      onChainEventId = eventId;
      const onChainEvent = await hederaService.getEvent(eventId);
      eventData = await filecoinService.getEventData(onChainEvent.ipfsHash);
    } else {
      const graphQuery = `
        query GetEvent($eventId: String!) {
          event(id: $eventId) {
            onChainId
            ipfsHash
          }
        }
      `;
      const graphResult = await graphService.query(graphQuery, { eventId });
      if (!graphResult.data.event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }
      onChainEventId = graphResult.data.event.onChainId;
      eventData = await filecoinService.getEventData(graphResult.data.event.ipfsHash);
    }

    // Verify user is within event location radius (simplified check)
    const eventLocation = eventData.location;
    const distance = calculateDistance(
      location.latitude,
      location.longitude,
      eventLocation.latitude,
      eventLocation.longitude
    );

    const maxDistance = eventLocation.radius || 1000; // Default 1km radius
    if (distance > maxDistance) {
      return res.status(400).json({
        success: false,
        message: 'You are not within the event location',
        distance,
        maxDistance
      });
    }

    // Join event on-chain (if not already joined)
    try {
      // Note: This would typically check if user is already a participant
      // For MVP, we'll just attempt to join
      await hederaService.joinEvent(onChainEventId, userAddress);
    } catch (error) {
      // User might already be joined, which is okay
      logger.info(`User ${userAddress} may already be joined to event ${onChainEventId}`);
    }

    // Store checkin data
    const checkinData = {
      eventId: eventData.id,
      onChainEventId,
      userAddress,
      location,
      timestamp: new Date().toISOString(),
      distance
    };

    // Upload checkin proof to Filecoin
    const checkinProof = await filecoinService.uploadUserData(checkinData, `checkin-${userAddress}-${eventData.id}`);

    logger.info(`User ${userAddress} checked into event ${eventData.id}`);

    res.json({
      success: true,
      message: 'Successfully checked into event',
      checkin: {
        eventId: eventData.id,
        eventName: eventData.name,
        timestamp: checkinData.timestamp,
        location: checkinData.location,
        proofHash: checkinProof.ipfsHash
      }
    });
  } catch (error) {
    logger.error('Failed to check into event:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check into event'
    });
  }
});

// Get event participants
router.get('/:eventId/participants', [
  param('eventId').notEmpty().withMessage('Event ID is required')
], async (req, res) => {
  try {
    const { eventId } = req.params;

    // Get participants from on-chain data
    let participants;
    
    if (/^\d+$/.test(eventId)) {
      participants = await hederaService.getEventParticipants(eventId);
    } else {
      const graphQuery = `
        query GetEvent($eventId: String!) {
          event(id: $eventId) {
            onChainId
          }
        }
      `;
      const graphResult = await graphService.query(graphQuery, { eventId });
      if (!graphResult.data.event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }
      participants = await hederaService.getEventParticipants(graphResult.data.event.onChainId);
    }

    res.json({
      success: true,
      participants,
      participantCount: participants.length
    });
  } catch (error) {
    logger.error('Failed to get event participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve event participants'
    });
  }
});

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

module.exports = router; 