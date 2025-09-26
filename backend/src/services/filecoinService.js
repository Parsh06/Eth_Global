const lighthouse = require('@lighthouse-web3/sdk');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class FilecoinService {
  constructor() {
    this.apiKey = process.env.LIGHTHOUSE_API_KEY;
    this.provider = process.env.STORAGE_PROVIDER || 'lighthouse';
    this.baseUrl = 'https://gateway.lighthouse.storage/ipfs/';
  }

  // Upload event metadata to Filecoin
  async uploadEventData(eventData) {
    try {
      const eventMetadata = {
        id: eventData.id,
        name: eventData.name,
        description: eventData.description,
        location: eventData.location,
        startDate: eventData.startDate,
        endDate: eventData.endDate,
        stalls: eventData.stalls,
        challenges: eventData.challenges,
        uploadedAt: new Date().toISOString(),
        version: '1.0'
      };

      const response = await lighthouse.uploadText(
        JSON.stringify(eventMetadata),
        this.apiKey,
        eventData.name || 'event-metadata'
      );

      logger.info(`Event data uploaded to Filecoin: ${response.data.Hash}`);

      return {
        success: true,
        ipfsHash: response.data.Hash,
        url: `${this.baseUrl}${response.data.Hash}`,
        size: response.data.Size
      };
    } catch (error) {
      logger.error('Failed to upload event data to Filecoin:', error);
      throw error;
    }
  }

  // Upload stall data with coordinates
  async uploadStallData(stallData) {
    try {
      const stallMetadata = {
        id: stallData.id,
        eventId: stallData.eventId,
        name: stallData.name,
        description: stallData.description,
        coordinates: {
          latitude: stallData.latitude,
          longitude: stallData.longitude
        },
        category: stallData.category,
        challenges: stallData.challenges || [],
        contact: stallData.contact,
        uploadedAt: new Date().toISOString()
      };

      const response = await lighthouse.uploadText(
        JSON.stringify(stallMetadata),
        this.apiKey,
        `stall-${stallData.id}`
      );

      logger.info(`Stall data uploaded to Filecoin: ${response.data.Hash}`);

      return {
        success: true,
        ipfsHash: response.data.Hash,
        url: `${this.baseUrl}${response.data.Hash}`,
        stallId: stallData.id
      };
    } catch (error) {
      logger.error('Failed to upload stall data to Filecoin:', error);
      throw error;
    }
  }

  // Upload challenge proof/submission
  async uploadChallengeProof(proofData) {
    try {
      const proofMetadata = {
        challengeId: proofData.challengeId,
        userId: proofData.userId,
        submissionType: proofData.type, // 'image', 'video', 'text', 'location'
        proof: proofData.proof,
        metadata: proofData.metadata,
        timestamp: new Date().toISOString(),
        location: proofData.location,
        verified: false
      };

      let uploadResponse;

      // Handle different types of proof uploads
      if (proofData.file) {
        // Upload file (image, video, etc.)
        uploadResponse = await lighthouse.upload(
          [proofData.file],
          this.apiKey,
          false,
          null,
          `challenge-proof-${proofData.challengeId}-${proofData.userId}`
        );
      } else {
        // Upload text/JSON data
        uploadResponse = await lighthouse.uploadText(
          JSON.stringify(proofMetadata),
          this.apiKey,
          `challenge-proof-${proofData.challengeId}-${proofData.userId}`
        );
      }

      logger.info(`Challenge proof uploaded to Filecoin: ${uploadResponse.data.Hash}`);

      return {
        success: true,
        ipfsHash: uploadResponse.data.Hash,
        url: `${this.baseUrl}${uploadResponse.data.Hash}`,
        challengeId: proofData.challengeId,
        userId: proofData.userId
      };
    } catch (error) {
      logger.error('Failed to upload challenge proof to Filecoin:', error);
      throw error;
    }
  }

  // Retrieve data from Filecoin/IPFS
  async retrieveData(ipfsHash) {
    try {
      const response = await axios.get(`${this.baseUrl}${ipfsHash}`, {
        timeout: 10000
      });

      logger.info(`Data retrieved from Filecoin: ${ipfsHash}`);

      return {
        success: true,
        data: response.data,
        ipfsHash
      };
    } catch (error) {
      logger.error(`Failed to retrieve data from Filecoin: ${ipfsHash}`, error);
      throw error;
    }
  }

  // Get event data by IPFS hash
  async getEventData(ipfsHash) {
    try {
      const result = await this.retrieveData(ipfsHash);
      return result.data;
    } catch (error) {
      logger.error('Failed to get event data:', error);
      throw error;
    }
  }

  // Get stall data by IPFS hash
  async getStallData(ipfsHash) {
    try {
      const result = await this.retrieveData(ipfsHash);
      return result.data;
    } catch (error) {
      logger.error('Failed to get stall data:', error);
      throw error;
    }
  }

  // Get challenge proof by IPFS hash
  async getChallengeProof(ipfsHash) {
    try {
      const result = await this.retrieveData(ipfsHash);
      return result.data;
    } catch (error) {
      logger.error('Failed to get challenge proof:', error);
      throw error;
    }
  }

  // Upload user-generated content
  async uploadUserContent(contentData) {
    try {
      const userContentMetadata = {
        userId: contentData.userId,
        eventId: contentData.eventId,
        type: contentData.type, // 'photo', 'video', 'comment', 'rating'
        content: contentData.content,
        metadata: contentData.metadata,
        timestamp: new Date().toISOString(),
        public: contentData.public || false
      };

      const response = await lighthouse.uploadText(
        JSON.stringify(userContentMetadata),
        this.apiKey,
        `user-content-${contentData.userId}-${Date.now()}`
      );

      logger.info(`User content uploaded to Filecoin: ${response.data.Hash}`);

      return {
        success: true,
        ipfsHash: response.data.Hash,
        url: `${this.baseUrl}${response.data.Hash}`,
        userId: contentData.userId
      };
    } catch (error) {
      logger.error('Failed to upload user content to Filecoin:', error);
      throw error;
    }
  }

  // Get storage stats
  async getStorageStats() {
    try {
      const response = await axios.get('https://api.lighthouse.storage/api/user/user_data_usage', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        success: true,
        usage: response.data
      };
    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      throw error;
    }
  }

  // Pin content to ensure persistence
  async pinContent(ipfsHash) {
    try {
      const response = await axios.post(
        `https://api.lighthouse.storage/api/lighthouse/pin`,
        { cid: ipfsHash },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Content pinned: ${ipfsHash}`);

      return {
        success: true,
        pinned: true,
        ipfsHash
      };
    } catch (error) {
      logger.error('Failed to pin content:', error);
      throw error;
    }
  }

  // List all uploads for the API key
  async listUploads() {
    try {
      const response = await axios.get('https://api.lighthouse.storage/api/user/get_uploads', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        success: true,
        uploads: response.data
      };
    } catch (error) {
      logger.error('Failed to list uploads:', error);
      throw error;
    }
  }

  // Create backup of critical data
  async createBackup(dataType, data) {
    try {
      const backupMetadata = {
        type: dataType,
        data: data,
        timestamp: new Date().toISOString(),
        version: '1.0',
        backup: true
      };

      const response = await lighthouse.uploadText(
        JSON.stringify(backupMetadata),
        this.apiKey,
        `backup-${dataType}-${Date.now()}`
      );

      // Pin the backup for extra persistence
      await this.pinContent(response.data.Hash);

      logger.info(`Backup created: ${dataType}, hash: ${response.data.Hash}`);

      return {
        success: true,
        ipfsHash: response.data.Hash,
        type: dataType,
        pinned: true
      };
    } catch (error) {
      logger.error('Failed to create backup:', error);
      throw error;
    }
  }
}

module.exports = new FilecoinService(); 