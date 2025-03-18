// services/followUpService.js - Service for handling symptom follow-ups

const { SymptomModel } = require('../models/dbModels');
const { sendWhatsAppMessage } = require('./messageService');
const symptomAssessmentService = require('./symptomAssessmentService');
const { standardizePhoneNumber } = require('../utils/messageUtils');
const sessionStore = require('../models/sessionStore');
const { dynamoDB } = require('../config/config');
const { DB_TABLES } = require('../config/config');

/**
 * Start a follow-up for active symptoms
 * @param {string} userPhone - User's phone number
 * @returns {Promise<boolean>} - Success status
 */
async function sendSymptomFollowUp(userPhone) {
  try {
    const standardizedPhone = standardizePhoneNumber(userPhone);
    console.log(`Starting follow-up for user: ${standardizedPhone}`);
    
    // Get active assessments for this user
    const assessments = await SymptomModel.getActiveAssessments(standardizedPhone);
    console.log(`Found ${assessments.length} active assessments for user`);
    
    if (assessments.length === 0) {
      return false;
    }
    
    // For each active assessment, send a follow-up message
    for (const assessment of assessments) {
      const daysSinceStart = Math.floor((Date.now() - new Date(assessment.createdAt).getTime()) / (24 * 60 * 60 * 1000));
      const followUpCount = assessment.followUps ? assessment.followUps.length : 0;
      
      let followUpMessage = `👋 *Follow-up: ${assessment.primarySymptom}*\n\n`;
      followUpMessage += `It's been ${followUpCount > 0 ? 'another ' : ''}day since you reported ${assessment.primarySymptom}. How are you feeling now?\n\n`;
      followUpMessage += `1️⃣ Better/Improved\n`;
      followUpMessage += `2️⃣ About the same\n`;
      followUpMessage += `3️⃣ Worse\n`;
      followUpMessage += `4️⃣ Complete follow-up (symptom resolved or no longer wish to track)\n\n`;
      followUpMessage += `Please reply with the number of your choice.`;
      
      // Send with both standardized and original phone format to ensure delivery
      await sendWhatsAppMessage(userPhone, followUpMessage);
      
      // Set user session to follow-up mode - store with BOTH formats to ensure we catch the response
      // First with standardized phone
      sessionStore.setUserSession(standardizedPhone, {
        type: 'follow_up',
        stage: 'status',
        assessmentId: assessment.assessmentId
      });
      
      // Also with original phone format if different
      if (standardizedPhone !== userPhone) {
        sessionStore.setUserSession(userPhone, {
          type: 'follow_up',
          stage: 'status',
          assessmentId: assessment.assessmentId
        });
      }
      
      console.log(`Set follow-up session for ${standardizedPhone} with assessmentId ${assessment.assessmentId}`);
      
      // For simplicity, we'll only send one follow-up at a time
      // If a user has multiple active assessments, we'll follow up on the rest later
      break;
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Error sending symptom follow-up: ${error}`);
    return false;
  }
}

/**
 * Check for assessments that need follow-up
 */
async function checkAndSendFollowUps() {
  try {
    const assessments = await SymptomModel.getAssessmentsNeedingFollowUp();
    console.log(`Found ${assessments.length} assessments needing follow-up`);
    
    for (const assessment of assessments) {
      await sendSymptomFollowUp(assessment.userPhone);
      
      // Add a short delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error(`❌ Error checking for follow-ups: ${error}`);
  }
}

/**
 * Process a follow-up response
 * @param {string} userPhone - User's phone number
 * @param {string} assessmentId - Assessment ID
 * @param {string} response - User's response
 * @returns {Promise<Object>} - Result with recommendations
 */
async function processFollowUpResponse(userPhone, assessmentId, response) {
  try {
    const standardizedPhone = standardizePhoneNumber(userPhone);
    console.log(`Processing follow-up response for user ${standardizedPhone}, assessment ${assessmentId}, response: "${response}"`);
    
    // Map numeric responses to status
    let status, notes = null;
    
    switch (response) {
      case "1":
        status = "improved";
        break;
      case "2":
        status = "same";
        break;
      case "3":
        status = "worse";
        break;
      case "4":
        status = "completed";
        break;
      default:
        // For text responses, try to categorize
        if (response.toLowerCase().includes('better') || 
            response.toLowerCase().includes('improv')) {
          status = "improved";
        } else if (response.toLowerCase().includes('same') ||
                  response.toLowerCase().includes('unchanged')) {
          status = "same";
        } else if (response.toLowerCase().includes('worse') ||
                  response.toLowerCase().includes('bad')) {
          status = "worse";
        } else if (response.toLowerCase().includes('complete') ||
                 response.toLowerCase().includes('stop') ||
                 response.toLowerCase().includes('done')) {
          status = "completed";
        } else {
          status = "same";
          notes = response; // Save the free text as notes
        }
    }
    
    console.log(`Mapped response to status: ${status}`);
    
    // Add the follow-up to the assessment
    await SymptomModel.addFollowUp(assessmentId, status, notes);
    console.log(`Added follow-up to assessment ${assessmentId}`);
    
    // Fetch the complete assessment to generate recommendations
    const params = {
      TableName: DB_TABLES.SYMPTOMS_TABLE,
      Key: { assessmentId }
    };
    
    console.log(`Fetching assessment details from DynamoDB`);
    const result = await dynamoDB.get(params).promise();
    const assessment = result.Item;
    
    if (!assessment) {
      console.error(`Assessment ${assessmentId} not found in database`);
      return {
        success: false,
        message: "Assessment not found"
      };
    }
    
    console.log(`Generating progression-based recommendations for ${assessment.primarySymptom}`);
    // Generate recommendations based on progression
    const recommendations = await symptomAssessmentService.getProgressionRecommendations(
      {
        primarySymptom: assessment.primarySymptom,
        answers: assessment.answers
      },
      assessment.followUps,
      status
    );
    
    return {
      success: true,
      status,
      recommendations,
      isCompleted: status === "completed"
    };
  } catch (error) {
    console.error(`❌ Error processing follow-up: ${error}`);
    return {
      success: false,
      message: "Error processing follow-up"
    };
  }
}

/**
 * Get assessment details for manual follow-up
 * @param {string} userPhone - User's phone number
 * @returns {Promise<Array>} - Active assessments
 */
async function getActiveAssessmentsForUser(userPhone) {
  const standardizedPhone = standardizePhoneNumber(userPhone);
  console.log(`Getting active assessments for ${standardizedPhone}`);
  
  try {
    const assessments = await SymptomModel.getActiveAssessments(standardizedPhone);
    return assessments;
  } catch (error) {
    console.error(`❌ Error getting active assessments: ${error}`);
    return [];
  }
}

// Start the follow-up scheduler
let followUpInterval = null;

function startFollowUpScheduler() {
    // Calculate time until next scheduled run (at a specific time each day)
    function scheduleNextRun() {
      const now = new Date();
      const scheduledTime = new Date(now);
      
      // Set the scheduled time to 9:00 AM
      scheduledTime.setHours(9, 0, 0, 0);
      
      // If it's already past the scheduled time for today, schedule for tomorrow
      if (now >= scheduledTime) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
      }
      
      // Calculate milliseconds until next run
      const timeUntilRun = scheduledTime.getTime() - now.getTime();
      
      console.log(`⏰ Scheduling next follow-up check for ${scheduledTime.toLocaleString()}`);
      
      // Schedule the next run
      return setTimeout(() => {
        console.log(`⏰ Running scheduled follow-up check`);
        checkAndSendFollowUps();
        
        // Schedule the next day's run
        followUpInterval = scheduleNextRun();
      }, timeUntilRun);
    }
    
    // Start the scheduler
    followUpInterval = scheduleNextRun();
    
    // Run immediately on startup if specified
    // Comment this out if you don't want an immediate check on server start
    console.log(`⏰ Running initial follow-up check on startup`);
    checkAndSendFollowUps();
  }
  
  function stopFollowUpScheduler() {
    if (followUpInterval) {
      clearTimeout(followUpInterval);
      followUpInterval = null;
      console.log("⏰ Follow-up scheduler stopped");
    }
  }

module.exports = {
  sendSymptomFollowUp,
  processFollowUpResponse,
  getActiveAssessmentsForUser,
  startFollowUpScheduler,
  stopFollowUpScheduler
};